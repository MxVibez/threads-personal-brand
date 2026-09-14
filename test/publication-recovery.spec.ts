import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { PublicationRecoveryService } from "../src/worker/publication-recovery.service";
import { BullPublicationQueue } from "../src/infrastructure/queue/bull-publication.queue";

describe("publication recovery", () => {
  it("enqueues jobs committed to SQL even if the original Redis call was lost", async () => {
    const time = new Date();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "job", scheduled_at: time }] }) };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() };
    const service = new PublicationRecoveryService(pool as unknown as Pool, queue);
    await service.recover();
    expect(queue.enqueue).toHaveBeenCalledWith("job", time);
  });
  it.each(["waiting", "active", "delayed"])("leaves an existing %s job alone", async state => {
    const job = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn(), retry: vi.fn() };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };
    await new BullPublicationQueue(queue as unknown as Queue<{ publicationJobId: string }>).enqueue("job");
    expect(queue.add).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(job.retry).not.toHaveBeenCalled();
  });
  it("restores an acknowledged job that is still pending in SQL", async () => {
    const job = { getState: vi.fn().mockResolvedValue("completed"), remove: vi.fn() };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };
    await new BullPublicationQueue(queue as unknown as Queue<{ publicationJobId: string }>).enqueue("job");
    expect(job.remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
  });
});
