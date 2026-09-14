import { describe, expect, it } from "vitest";
import { ApproveDraftService } from "../src/domain/drafts/approve-draft.service";
import type { PublicationQueue } from "../src/domain/publication/publication-queue";
import { InMemoryDraftRepository } from "./support/in-memory-draft.repository";

class DeduplicatingQueue implements PublicationQueue {
  readonly jobs = new Set<string>();

  async enqueue(publicationJobId: string): Promise<void> {
    this.jobs.add(publicationJobId);
  }

  async cancel(publicationJobId: string): Promise<void> {
    this.jobs.delete(publicationJobId);
  }
}

describe("ApproveDraftService", () => {
  it("creates one publication job when the expert clicks twice", async () => {
    const drafts = new InMemoryDraftRepository();
    const queue = new DeduplicatingQueue();
    const service = new ApproveDraftService(drafts, queue);
    const draft = drafts.create({ expertTelegramId: "1001" });

    const first = await service.execute({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001"
    });
    const second = await service.execute({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001"
    });

    expect(first.alreadyApproved).toBe(false);
    expect(second.alreadyApproved).toBe(true);
    expect(second.publicationJob.id).toBe(first.publicationJob.id);
    expect(queue.jobs).toEqual(new Set([first.publicationJob.id]));
  });

  it("does not allow another Telegram user to approve the draft", async () => {
    const drafts = new InMemoryDraftRepository();
    const queue = new DeduplicatingQueue();
    const service = new ApproveDraftService(drafts, queue);
    const draft = drafts.create({ expertTelegramId: "1001" });

    await expect(
      service.execute({
        draftId: draft.id,
        expectedVersion: 1,
        expertTelegramId: "2002"
      })
    ).rejects.toThrow("нет доступа");
    expect(queue.jobs.size).toBe(0);
  });

  it("keeps the selected publication time in the plan", async () => {
    const drafts = new InMemoryDraftRepository();
    const queue = new DeduplicatingQueue();
    const service = new ApproveDraftService(drafts, queue);
    const draft = drafts.create({ expertTelegramId: "1001" });
    const scheduledAt = new Date("2026-09-05T08:30:00.000Z");

    await service.execute({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001",
      scheduledAt
    });

    const plan = await drafts.listPlannedByExpert("1001");
    expect(plan).toHaveLength(1);
    expect(plan[0]?.scheduledAt.toISOString()).toBe(scheduledAt.toISOString());
    expect(plan[0]?.title).toBe("Тестовая ветка");
  });

  it("removes a cancelled publication from the shared plan", async () => {
    const drafts = new InMemoryDraftRepository();
    const queue = new DeduplicatingQueue();
    const service = new ApproveDraftService(drafts, queue);
    const draft = drafts.create({ expertTelegramId: "1001" });
    const approved = await service.execute({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001",
      scheduledAt: new Date("2026-09-05T08:30:00.000Z")
    });

    await drafts.cancelPlannedPublication({
      publicationJobId: approved.publicationJob.id,
      expertTelegramId: "1001",
      actorTelegramId: "2002"
    });
    await queue.cancel(approved.publicationJob.id);

    expect(await drafts.listPlannedByExpert("1001")).toEqual([]);
    expect(queue.jobs.has(approved.publicationJob.id)).toBe(false);
  });

  it("does not approve an outdated draft version", async () => {
    const drafts = new InMemoryDraftRepository();
    const queue = new DeduplicatingQueue();
    const service = new ApproveDraftService(drafts, queue);
    const draft = drafts.create({ expertTelegramId: "1001", version: 2 });

    await expect(
      service.execute({
        draftId: draft.id,
        expectedVersion: 1,
        expertTelegramId: "1001"
      })
    ).rejects.toThrow("уже изменился");
    expect(queue.jobs.size).toBe(0);
  });

  it("treats a repeated rejection as the same decision", async () => {
    const drafts = new InMemoryDraftRepository();
    const draft = drafts.create({ expertTelegramId: "1001" });

    const first = await drafts.reject({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001",
      reason: "Не мой стиль"
    });
    const second = await drafts.reject({
      draftId: draft.id,
      expectedVersion: 1,
      expertTelegramId: "1001",
      reason: "Не мой стиль"
    });

    expect(first.status).toBe("REJECTED");
    expect(second.status).toBe("REJECTED");
  });
});
