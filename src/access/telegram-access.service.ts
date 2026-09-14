import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool, PoolClient } from "pg";
import { parseExpertTelegramIds } from "../config/env";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";

export interface AccessApplicant {
  telegramId: string;
  displayName: string;
  username?: string;
}

export interface AccessRequestView extends AccessApplicant {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: Date;
}

export interface TesterAccessView extends AccessApplicant {
  grantedByTelegramId: string;
  createdAt: Date;
}

interface AccessRequestRow {
  id: string;
  telegram_id: string;
  display_name: string;
  username: string | null;
  status: AccessRequestView["status"];
  requested_at: Date;
}

interface TesterAccessRow {
  telegram_id: string;
  display_name: string | null;
  username: string | null;
  granted_by_telegram_id: string;
  created_at: Date;
}

export class AccessAdminForbiddenError extends Error {
  constructor() {
    super("Только владелец может управлять доступом");
    this.name = "AccessAdminForbiddenError";
  }
}

@Injectable()
export class TelegramAccessService {
  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool
  ) {}

  ownerIds(): string[] {
    return [...parseExpertTelegramIds(
      this.config.get<string>("EXPERT_TELEGRAM_IDS", "")
    )];
  }

  isOwner(telegramId: string): boolean {
    return this.ownerIds().includes(telegramId);
  }

  canMutateWorkspace(telegramId: string): boolean {
    const dryRun = this.config.get<string>("THREADS_DRY_RUN", "true") === "true";
    return dryRun || this.isOwner(telegramId);
  }

  workspaceTelegramId(): string {
    const ownerId = this.ownerIds()[0];
    if (!ownerId) throw new Error("Владелец общего пространства не настроен");
    return ownerId;
  }

  async canUseMiniApp(telegramId: string): Promise<boolean> {
    if (this.isOwner(telegramId)) return true;
    const result = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM miniapp_access
         WHERE telegram_id = $1 AND active = TRUE
       ) AS allowed`,
      [telegramId]
    );
    return result.rows[0]?.allowed === true;
  }

  async requestAccess(
    applicant: AccessApplicant
  ): Promise<{ request: AccessRequestView; created: boolean }> {
    if (await this.canUseMiniApp(applicant.telegramId)) {
      throw new Error("Доступ уже открыт");
    }

    const inserted = await this.pool.query<AccessRequestRow>(
      `INSERT INTO miniapp_access_requests (
         telegram_id, display_name, username, status
       ) VALUES ($1, $2, $3, 'PENDING')
       ON CONFLICT (telegram_id) WHERE status = 'PENDING' DO NOTHING
       RETURNING id, telegram_id::text, display_name, username, status, requested_at`,
      [applicant.telegramId, applicant.displayName, applicant.username ?? null]
    );
    const created = inserted.rows[0];
    if (created) return { request: this.mapRequest(created), created: true };

    const existing = await this.pool.query<AccessRequestRow>(
      `SELECT id, telegram_id::text, display_name, username, status, requested_at
       FROM miniapp_access_requests
       WHERE telegram_id = $1 AND status = 'PENDING'
       ORDER BY requested_at DESC
       LIMIT 1`,
      [applicant.telegramId]
    );
    const request = existing.rows[0];
    if (!request) throw new Error("Не удалось сохранить запрос доступа");
    return { request: this.mapRequest(request), created: false };
  }

  async listPendingRequests(limit = 10): Promise<AccessRequestView[]> {
    const result = await this.pool.query<AccessRequestRow>(
      `SELECT id, telegram_id::text, display_name, username, status, requested_at
       FROM miniapp_access_requests
       WHERE status = 'PENDING'
       ORDER BY requested_at ASC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 20))]
    );
    return result.rows.map((row) => this.mapRequest(row));
  }

  async listActiveTesters(limit = 20): Promise<TesterAccessView[]> {
    const result = await this.pool.query<TesterAccessRow>(
      `SELECT
         telegram_id::text,
         display_name,
         username,
         granted_by_telegram_id::text,
         created_at
       FROM miniapp_access
       WHERE active = TRUE
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 50))]
    );
    return result.rows.map((row) => ({
      telegramId: row.telegram_id,
      displayName: row.display_name || `ID ${row.telegram_id}`,
      ...(row.username ? { username: row.username } : {}),
      grantedByTelegramId: row.granted_by_telegram_id,
      createdAt: row.created_at
    }));
  }

  async decideRequest(
    ownerTelegramId: string,
    requestId: string,
    decision: "APPROVED" | "REJECTED"
  ): Promise<{ request: AccessRequestView; alreadyDecided: boolean }> {
    this.assertOwner(ownerTelegramId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<AccessRequestRow>(
        `SELECT id, telegram_id::text, display_name, username, status, requested_at
         FROM miniapp_access_requests
         WHERE id = $1
         FOR UPDATE`,
        [requestId]
      );
      const row = locked.rows[0];
      if (!row) throw new Error("Запрос доступа не найден");
      if (row.status !== "PENDING") {
        await client.query("COMMIT");
        return { request: this.mapRequest(row), alreadyDecided: true };
      }

      if (decision === "APPROVED") {
        await client.query(
          `INSERT INTO miniapp_access (
             telegram_id, role, display_name, username,
             granted_by_telegram_id, active
           ) VALUES ($1, 'TESTER', $2, $3, $4, TRUE)
           ON CONFLICT (telegram_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             username = EXCLUDED.username,
             granted_by_telegram_id = EXCLUDED.granted_by_telegram_id,
             active = TRUE,
             updated_at = NOW()`,
          [row.telegram_id, row.display_name, row.username, ownerTelegramId]
        );
      }

      const updated = await client.query<AccessRequestRow>(
        `UPDATE miniapp_access_requests
         SET status = $2, decided_at = NOW(), decided_by_telegram_id = $3
         WHERE id = $1
         RETURNING id, telegram_id::text, display_name, username, status, requested_at`,
        [requestId, decision, ownerTelegramId]
      );
      await this.writeAudit(client, ownerTelegramId, decision, row.telegram_id, {
        requestId
      });
      const decided = updated.rows[0];
      if (!decided) throw new Error("Не удалось обновить запрос доступа");
      await client.query("COMMIT");
      return { request: this.mapRequest(decided), alreadyDecided: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeTester(ownerTelegramId: string, testerTelegramId: string): Promise<boolean> {
    this.assertOwner(ownerTelegramId);
    if (this.isOwner(testerTelegramId)) {
      throw new Error("Нельзя отозвать доступ владельца");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE miniapp_access
         SET active = FALSE, updated_at = NOW()
         WHERE telegram_id = $1 AND active = TRUE`,
        [testerTelegramId]
      );
      if ((result.rowCount ?? 0) > 0) {
        await this.writeAudit(
          client,
          ownerTelegramId,
          "REVOKED",
          testerTelegramId,
          {}
        );
      }
      await client.query("COMMIT");
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private assertOwner(telegramId: string): void {
    if (!this.isOwner(telegramId)) throw new AccessAdminForbiddenError();
  }

  private mapRequest(row: AccessRequestRow): AccessRequestView {
    return {
      id: row.id,
      telegramId: row.telegram_id,
      displayName: row.display_name,
      ...(row.username ? { username: row.username } : {}),
      status: row.status,
      requestedAt: row.requested_at
    };
  }

  private async writeAudit(
    client: PoolClient,
    actorTelegramId: string,
    decision: "APPROVED" | "REJECTED" | "REVOKED",
    targetTelegramId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (
         actor_telegram_id, action, entity_type, entity_id, metadata
       ) VALUES ($1, $2, 'miniapp_access', $3, $4::jsonb)`,
      [
        actorTelegramId,
        `ACCESS_${decision}`,
        targetTelegramId,
        JSON.stringify(metadata)
      ]
    );
  }
}
