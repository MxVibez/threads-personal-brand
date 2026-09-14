import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "./database.tokens";

export const TELEGRAM_UPDATE_STORE = Symbol("TELEGRAM_UPDATE_STORE");

export interface TelegramUpdateStore {
  claim(updateId: number): Promise<boolean>;
  markProcessed(updateId: number): Promise<void>;
  markFailed(updateId: number, error: string): Promise<void>;
}

@Injectable()
export class PostgresTelegramUpdateStore implements TelegramUpdateStore {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async claim(updateId: number): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO telegram_updates (update_id, status)
       VALUES ($1, 'PROCESSING')
       ON CONFLICT (update_id) DO UPDATE
       SET status = 'PROCESSING',
           attempts = telegram_updates.attempts + 1,
           last_error = NULL,
           received_at = NOW()
       WHERE telegram_updates.status = 'FAILED'
          OR (
            telegram_updates.status = 'PROCESSING'
            AND telegram_updates.received_at < NOW() - INTERVAL '5 minutes'
          )
       RETURNING update_id`,
      [updateId]
    );
    return result.rowCount === 1;
  }

  async markProcessed(updateId: number): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_updates
       SET status = 'PROCESSED', processed_at = NOW(), last_error = NULL
       WHERE update_id = $1`,
      [updateId]
    );
  }

  async markFailed(updateId: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_updates
       SET status = 'FAILED', last_error = $2
       WHERE update_id = $1`,
      [updateId, error.slice(0, 1000)]
    );
  }
}
