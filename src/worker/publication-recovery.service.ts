import { Inject, Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";
import { PUBLICATION_QUEUE, type PublicationQueue } from "../domain/publication/publication-queue";

@Injectable()
export class PublicationRecoveryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PublicationRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PUBLICATION_QUEUE) private readonly queue: PublicationQueue
  ) {}

  onModuleInit() {
    void this.recover();
    this.timer = setInterval(() => void this.recover(), 60_000);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  async recover(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.reconcile().catch(() => this.logger.error("Could not reconcile publication queue"));
    await this.running;
    this.running = null;
  }

  private async reconcile() {
    const result = await this.pool.query<{ id: string; scheduled_at: Date }>(
      `SELECT id, scheduled_at FROM publication_jobs
       WHERE (status = 'PENDING' AND scheduled_at <= NOW() + INTERVAL '1 hour')
          OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes' AND attempts < 5)
       ORDER BY scheduled_at ASC LIMIT 100`
    );
    for (const job of result.rows) await this.queue.enqueue(job.id, job.scheduled_at);
  }
}
