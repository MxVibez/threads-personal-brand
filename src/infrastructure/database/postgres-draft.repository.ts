import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  DraftAccessDeniedError,
  DraftNotFoundError,
  DraftStateError,
  DraftVersionConflictError
} from "../../domain/drafts/draft.errors";
import type {
  ApproveDraftInput,
  CancelPlannedPublicationInput,
  DraftRepository,
  RejectDraftInput
} from "../../domain/drafts/draft.repository";
import type {
  ApprovalResult,
  DraftSource,
  DraftStatus,
  DraftView,
  PlannedPublicationView,
  PublicationJobView
} from "../../domain/drafts/draft.types";
import { DATABASE_POOL } from "./database.tokens";

interface DraftRow {
  id: string;
  expert_telegram_id: string;
  title: string;
  status: DraftStatus;
  current_version: number;
  version_id: string;
  sources: DraftSource[];
  analysis: DraftView["analysis"];
  created_at: Date;
}

interface SegmentRow {
  text: string;
}

interface PublicationJobRow {
  id: string;
  draft_id: string;
  draft_version_id: string;
  idempotency_key: string;
  status: PublicationJobView["status"];
  scheduled_at: Date;
}

@Injectable()
export class PostgresDraftRepository implements DraftRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async createDemo(expertTelegramId: string): Promise<DraftView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const draftResult = await client.query<{ id: string }>(
        `INSERT INTO drafts (
           expert_telegram_id, title, status, current_version, sources, analysis
         ) VALUES ($1, $2, 'WAITING_APPROVAL', 1, $3::jsonb, $4::jsonb)
         RETURNING id`,
        [
          expertTelegramId,
          "Как превратить рабочее наблюдение в полезную публикацию",
          JSON.stringify([
            {
              label: "Тестовый источник для проверки механики",
              url: "https://www.threads.com/",
              meta: "Демонстрационный источник"
            }
          ]),
          JSON.stringify({
            format: "Ветка · 3 поста",
            signal: "Тестовый материал",
            mentions: 0,
            freshness: "для проверки механики",
            goal: "Проверить полный путь от свайпа до публикации",
            discussionPotential: "На проверке",
            risk: "Нужна проверка",
            audience: "Аудитория личного бренда",
            insight:
              "Это демонстрационная ветка. После подключения Apify здесь появится вывод по реальным публичным обсуждениям.",
            evidence: [
              "Карточка создана только для проверки Mini App.",
              "Реальных рыночных метрик у этого материала пока нет.",
              "Threads работает в режиме dry-run и ничего не публикует."
            ]
          })
        ]
      );
      const draftId = draftResult.rows[0]?.id;
      if (!draftId) throw new Error("Draft insert did not return an id");

      const versionResult = await client.query<{ id: string }>(
        `INSERT INTO draft_versions (draft_id, version)
         VALUES ($1, 1)
         RETURNING id`,
        [draftId]
      );
      const versionId = versionResult.rows[0]?.id;
      if (!versionId) throw new Error("Draft version insert did not return an id");

      const segments = [
        "Это нейтральный демонстрационный материал для проверки очереди контента.",
        "Здесь появится основной тезис после настройки тем и голоса личного бренда.",
        "Перед публикацией автор проверяет факты, формулировки и соответствие своей позиции."
      ];

      for (const [position, text] of segments.entries()) {
        await client.query(
          `INSERT INTO draft_segments (draft_version_id, position, text)
           VALUES ($1, $2, $3)`,
          [versionId, position, text]
        );
      }

      const created = await this.readDraft(client, draftId);
      if (!created) throw new Error("Created draft could not be read");
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(draftId: string): Promise<DraftView | null> {
    const client = await this.pool.connect();
    try {
      return await this.readDraft(client, draftId);
    } finally {
      client.release();
    }
  }

  async listWaitingByExpert(
    expertTelegramId: string,
    limit = 20
  ): Promise<DraftView[]> {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const result = await this.pool.query<DraftRow & { segments: string[] }>(
      `WITH waiting AS (
         SELECT * FROM drafts
         WHERE expert_telegram_id = $1 AND status = 'WAITING_APPROVAL'
         ORDER BY created_at ASC, id ASC LIMIT $2
       )
       SELECT d.*, d.expert_telegram_id::text, dv.id AS version_id,
         COALESCE((SELECT jsonb_agg(ds.text ORDER BY ds.position)
                   FROM draft_segments ds WHERE ds.draft_version_id = dv.id), '[]'::jsonb) AS segments
       FROM waiting d JOIN draft_versions dv
         ON dv.draft_id = d.id AND dv.version = d.current_version
       ORDER BY d.created_at ASC, d.id ASC`,
      [expertTelegramId, safeLimit]
    );
    return result.rows.map((row) => ({
      id: row.id, expertTelegramId: row.expert_telegram_id, title: row.title,
      status: row.status, currentVersion: row.current_version, versionId: row.version_id,
      segments: row.segments, sources: row.sources, analysis: row.analysis ?? {}, createdAt: row.created_at
    }));
  }

  async listPlannedByExpert(
    expertTelegramId: string,
    limit = 30
  ): Promise<PlannedPublicationView[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const result = await this.pool.query<{
      id: string;
      draft_id: string;
      title: string;
      scheduled_at: Date;
      status: PublicationJobView["status"];
    }>(
      `SELECT pj.id, pj.draft_id, d.title, pj.scheduled_at, pj.status
       FROM publication_jobs pj
       JOIN drafts d ON d.id = pj.draft_id
       WHERE d.expert_telegram_id = $1
         AND pj.status IN ('PENDING', 'PROCESSING', 'FAILED', 'PARTIAL_FAILED', 'NEEDS_REVIEW')
       ORDER BY pj.scheduled_at ASC
       LIMIT $2`,
      [expertTelegramId, safeLimit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      draftId: row.draft_id,
      title: row.title,
      scheduledAt: row.scheduled_at,
      status: row.status
    }));
  }

  async cancelPlannedPublication(
    input: CancelPlannedPublicationInput
  ): Promise<PlannedPublicationView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        id: string;
        draft_id: string;
        expert_telegram_id: string;
        title: string;
        scheduled_at: Date;
        status: PublicationJobView["status"];
      }>(
        `SELECT pj.id, pj.draft_id, d.expert_telegram_id::text,
                d.title, pj.scheduled_at, pj.status
         FROM publication_jobs pj
         JOIN drafts d ON d.id = pj.draft_id
         WHERE pj.id = $1
         FOR UPDATE OF pj`,
        [input.publicationJobId]
      );
      const row = locked.rows[0];
      if (!row) throw new DraftNotFoundError();
      if (row.expert_telegram_id !== input.expertTelegramId) {
        throw new DraftAccessDeniedError();
      }
      if (row.status !== "PENDING" && row.status !== "CANCELLED") {
        throw new DraftStateError(row.status);
      }

      if (row.status !== "CANCELLED") {
        await client.query(
          `UPDATE publication_jobs
           SET status = 'CANCELLED', updated_at = NOW(), last_error = NULL
           WHERE id = $1`,
          [row.id]
        );
        await client.query(
          `UPDATE drafts SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
          [row.draft_id]
        );
        await client.query(
          `INSERT INTO audit_log (
             actor_telegram_id, action, entity_type, entity_id, metadata
           ) VALUES ($1, 'PUBLICATION_CANCELLED', 'publication_job', $2, $3::jsonb)`,
          [
            input.actorTelegramId ?? input.expertTelegramId,
            row.id,
            JSON.stringify({ draftId: row.draft_id, scheduledAt: row.scheduled_at })
          ]
        );
      }

      await client.query("COMMIT");
      return {
        id: row.id,
        draftId: row.draft_id,
        title: row.title,
        scheduledAt: row.scheduled_at,
        status: "CANCELLED"
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async approve(input: ApproveDraftInput): Promise<ApprovalResult> {
    const client = await this.pool.connect();
    const idempotencyKey = `publish:${input.draftId}:v${input.expectedVersion}`;

    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        expert_telegram_id: string;
        status: DraftStatus;
        current_version: number;
      }>(
        `SELECT expert_telegram_id::text, status, current_version
         FROM drafts
         WHERE id = $1
         FOR UPDATE`,
        [input.draftId]
      );

      const row = locked.rows[0];
      if (!row) throw new DraftNotFoundError();
      if (row.expert_telegram_id !== input.expertTelegramId) {
        throw new DraftAccessDeniedError();
      }

      const existingResult = await client.query<PublicationJobRow>(
        `SELECT id, draft_id, draft_version_id, idempotency_key, status, scheduled_at
         FROM publication_jobs
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      const existingJob = existingResult.rows[0];
      if (existingJob) {
        if (existingJob.status === "CANCELLED") throw new DraftStateError("CANCELLED");
        const draft = await this.readDraft(client, input.draftId);
        if (!draft) throw new DraftNotFoundError();
        await client.query("COMMIT");
        return {
          draft,
          publicationJob: this.mapPublicationJob(existingJob),
          alreadyApproved: true
        };
      }

      if (row.current_version !== input.expectedVersion) {
        throw new DraftVersionConflictError();
      }
      if (row.status !== "WAITING_APPROVAL") {
        throw new DraftStateError(row.status);
      }

      const versionResult = await client.query<{ id: string }>(
        `SELECT id FROM draft_versions
         WHERE draft_id = $1 AND version = $2`,
        [input.draftId, input.expectedVersion]
      );
      const versionId = versionResult.rows[0]?.id;
      if (!versionId) throw new DraftVersionConflictError();

      await client.query(
        `UPDATE drafts
         SET status = 'APPROVED', updated_at = NOW()
         WHERE id = $1`,
        [input.draftId]
      );

      const jobResult = await client.query<PublicationJobRow>(
        `INSERT INTO publication_jobs (
           draft_id, draft_version_id, idempotency_key, status, scheduled_at, dry_run
         ) VALUES ($1, $2, $3, 'PENDING', $4, $5)
         RETURNING id, draft_id, draft_version_id, idempotency_key, status, scheduled_at`,
        [input.draftId, versionId, idempotencyKey, input.scheduledAt ?? new Date(), input.dryRun ?? true]
      );
      const job = jobResult.rows[0];
      if (!job) throw new Error("Publication job insert did not return an id");

      await client.query(
        `INSERT INTO publication_segments (
           publication_job_id, position, text, status
         )
         SELECT $1, position, text, 'PENDING'
         FROM draft_segments
         WHERE draft_version_id = $2
         ORDER BY position`,
        [job.id, versionId]
      );

      await client.query(
        `INSERT INTO approval_events (
           draft_id, draft_version_id, expert_telegram_id, action
         ) VALUES ($1, $2, $3, 'APPROVED')`,
        [input.draftId, versionId, input.actorTelegramId ?? input.expertTelegramId]
      );

      await client.query(
        `INSERT INTO audit_log (
           actor_telegram_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'DRAFT_APPROVED', 'draft', $2, $3::jsonb)`,
        [
          input.actorTelegramId ?? input.expertTelegramId,
          input.draftId,
          JSON.stringify({ version: input.expectedVersion, publicationJobId: job.id })
        ]
      );

      const draft = await this.readDraft(client, input.draftId);
      if (!draft) throw new DraftNotFoundError();
      await client.query("COMMIT");
      return {
        draft,
        publicationJob: this.mapPublicationJob(job),
        alreadyApproved: false
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(input: RejectDraftInput): Promise<DraftView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        expert_telegram_id: string;
        status: DraftStatus;
        current_version: number;
      }>(
        `SELECT expert_telegram_id::text, status, current_version
         FROM drafts WHERE id = $1 FOR UPDATE`,
        [input.draftId]
      );
      const row = locked.rows[0];
      if (!row) throw new DraftNotFoundError();
      if (row.expert_telegram_id !== input.expertTelegramId) {
        throw new DraftAccessDeniedError();
      }
      if (row.current_version !== input.expectedVersion) {
        throw new DraftVersionConflictError();
      }
      if (row.status === "REJECTED") {
        const rejected = await this.readDraft(client, input.draftId);
        if (!rejected) throw new DraftNotFoundError();
        await client.query("COMMIT");
        return rejected;
      }
      if (row.status !== "WAITING_APPROVAL") {
        throw new DraftStateError(row.status);
      }

      const versionResult = await client.query<{ id: string }>(
        `SELECT id FROM draft_versions WHERE draft_id = $1 AND version = $2`,
        [input.draftId, input.expectedVersion]
      );
      const versionId = versionResult.rows[0]?.id;
      if (!versionId) throw new DraftVersionConflictError();

      await client.query(
        `UPDATE drafts SET status = 'REJECTED', updated_at = NOW() WHERE id = $1`,
        [input.draftId]
      );
      await client.query(
        `INSERT INTO approval_events (
           draft_id, draft_version_id, expert_telegram_id, action, reason
         ) VALUES ($1, $2, $3, 'REJECTED', $4)`,
        [input.draftId, versionId, input.actorTelegramId ?? input.expertTelegramId, input.reason]
      );
      await client.query(
        `INSERT INTO audit_log (
           actor_telegram_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'DRAFT_REJECTED', 'draft', $2, $3::jsonb)`,
        [
          input.actorTelegramId ?? input.expertTelegramId,
          input.draftId,
          JSON.stringify({ version: input.expectedVersion, reason: input.reason })
        ]
      );
      const draft = await this.readDraft(client, input.draftId);
      if (!draft) throw new DraftNotFoundError();
      await client.query("COMMIT");
      return draft;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async readDraft(client: PoolClient, draftId: string): Promise<DraftView | null> {
    const draftResult = await client.query<DraftRow>(
      `SELECT
         d.id,
         d.expert_telegram_id::text,
         d.title,
         d.status,
         d.current_version,
         d.sources,
         d.analysis,
         d.created_at,
         dv.id AS version_id
       FROM drafts d
       JOIN draft_versions dv
         ON dv.draft_id = d.id AND dv.version = d.current_version
       WHERE d.id = $1`,
      [draftId]
    );
    const row = draftResult.rows[0];
    if (!row) return null;

    const segmentResult = await client.query<SegmentRow>(
      `SELECT text
       FROM draft_segments
       WHERE draft_version_id = $1
       ORDER BY position`,
      [row.version_id]
    );

    return {
      id: row.id,
      expertTelegramId: row.expert_telegram_id,
      title: row.title,
      status: row.status,
      currentVersion: row.current_version,
      versionId: row.version_id,
      segments: segmentResult.rows.map((segment) => segment.text),
      sources: row.sources,
      analysis: row.analysis ?? {},
      createdAt: row.created_at
    };
  }

  private mapPublicationJob(row: PublicationJobRow): PublicationJobView {
    return {
      id: row.id,
      draftId: row.draft_id,
      draftVersionId: row.draft_version_id,
      idempotencyKey: row.idempotency_key,
      scheduledAt: row.scheduled_at,
      status: row.status
    };
  }
}
