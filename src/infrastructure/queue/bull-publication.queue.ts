import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { PublicationQueue } from "../../domain/publication/publication-queue";
import { BULL_PUBLICATION_QUEUE } from "./queue.tokens";

@Injectable()
export class BullPublicationQueue implements PublicationQueue {
  constructor(
    @Inject(BULL_PUBLICATION_QUEUE)
    private readonly queue: Queue<{ publicationJobId: string }>
  ) {}

  async enqueue(publicationJobId: string, scheduledAt = new Date()): Promise<void> {
    const existing = await this.queue.getJob(publicationJobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") { await existing.retry(); return; }
      if (state !== "completed") return;
      // A worker may have acknowledged a job before its database lease expired.
      await existing.remove();
    }
    const delay = Math.max(0, scheduledAt.getTime() - Date.now());
    await this.queue.add(
      "publish",
      { publicationJobId },
      {
        jobId: publicationJobId,
        delay,
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000
      }
    );
  }

  async cancel(publicationJobId: string): Promise<void> {
    const job = await this.queue.getJob(publicationJobId);
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // База уже пометит задание отменённым. Даже если активную запись Redis
      // удалить нельзя, worker не сможет захватить CANCELLED-задание.
    }
  }
}
