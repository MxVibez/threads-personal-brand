import { describe, expect, it, vi } from "vitest";
import type { PublicationNotifier } from "../src/domain/publication/publication-notifier";
import { ProcessPublicationService } from "../src/domain/publication/process-publication.service";
import type { PublicationJobRecord } from "../src/domain/publication/publication.types";
import {
  ThreadsPublishError,
  type CreateThreadsContainerInput,
  type ThreadsPublisher
} from "../src/domain/publication/threads-publisher";
import { InMemoryPublicationRepository } from "./support/in-memory-publication.repository";

class RecordingPublisher implements ThreadsPublisher {
  readonly dryRun = true;
  readonly created: CreateThreadsContainerInput[] = [];
  readonly sent: string[] = [];
  failAmbiguously = false;

  async createTextContainer(input: CreateThreadsContainerInput): Promise<string> {
    this.created.push(input);
    return `container-${input.segmentPosition}`;
  }

  async publishContainer(containerId: string): Promise<string> {
    this.sent.push(containerId);
    if (this.failAmbiguously) {
      throw new ThreadsPublishError("Ответ Threads потерян", true);
    }
    return containerId.replace("container", "media");
  }
}

class RecordingNotifier implements PublicationNotifier {
  published = 0;
  needsReview = 0;

  async notifyPublished(): Promise<void> {
    this.published += 1;
  }

  async notifyNeedsReview(): Promise<void> {
    this.needsReview += 1;
  }
}

function jobFixture(): PublicationJobRecord {
  return {
    id: "job-1",
    draftId: "draft-1",
    expertTelegramId: "1001",
    dryRun: true,
    status: "PARTIAL_FAILED",
    segments: [
      {
        id: "segment-1",
        position: 0,
        text: "Первый сегмент",
        status: "PUBLISHED",
        threadsContainerId: "container-0",
        threadsMediaId: "media-0"
      },
      {
        id: "segment-2",
        position: 1,
        text: "Второй сегмент",
        status: "FAILED",
        threadsContainerId: null,
        threadsMediaId: null
      }
    ]
  };
}

describe("ProcessPublicationService", () => {
  it("does not silently change the mode of an already approved publication", async () => {
    const fixture = jobFixture();
    fixture.dryRun = false;
    const repository = new InMemoryPublicationRepository(fixture);
    const publisher = new RecordingPublisher();
    await new ProcessPublicationService(repository, publisher, new RecordingNotifier()).execute("job-1");
    expect(publisher.sent).toHaveLength(0);
    expect(repository.job.status).toBe("NEEDS_REVIEW");
  });
  it("does not resend after Threads succeeds but saving the media id fails", async () => {
    const repository = new InMemoryPublicationRepository(jobFixture());
    vi.spyOn(repository, "markSegmentPublished").mockRejectedValueOnce(new Error("Database disconnected"));
    const publisher = new RecordingPublisher();
    const service = new ProcessPublicationService(repository, publisher, new RecordingNotifier());
    await service.execute("job-1");
    await service.execute("job-1");
    expect(repository.job.status).toBe("NEEDS_REVIEW");
    expect(publisher.sent).toHaveLength(1);
  });

  it("keeps NEEDS_REVIEW when Telegram notification fails", async () => {
    const repository = new InMemoryPublicationRepository(jobFixture());
    const publisher = new RecordingPublisher();
    publisher.failAmbiguously = true;
    const notifier = new RecordingNotifier();
    vi.spyOn(notifier, "notifyNeedsReview").mockRejectedValue(new Error("Telegram unavailable"));
    const service = new ProcessPublicationService(repository, publisher, notifier);
    await service.execute("job-1");
    await service.execute("job-1");
    expect(repository.job.status).toBe("NEEDS_REVIEW");
    expect(publisher.sent).toHaveLength(1);
  });

  it("does not send again after restarting during an in-flight publish", async () => {
    const fixture = jobFixture();
    fixture.segments[1]!.status = "PUBLISHING";
    fixture.segments[1]!.threadsContainerId = "container-1";
    const repository = new InMemoryPublicationRepository(fixture);
    const publisher = new RecordingPublisher();
    await new ProcessPublicationService(repository, publisher, new RecordingNotifier()).execute("job-1");
    expect(publisher.sent).toHaveLength(0);
    expect(repository.job.status).toBe("NEEDS_REVIEW");
  });

  it("reuses the stored container after an explicit rejection", async () => {
    const fixture = jobFixture();
    fixture.segments[1]!.threadsContainerId = "container-existing";
    const repository = new InMemoryPublicationRepository(fixture);
    const publisher = new RecordingPublisher();
    vi.spyOn(publisher, "publishContainer").mockRejectedValueOnce(new ThreadsPublishError("Rate limit", false));
    const service = new ProcessPublicationService(repository, publisher, new RecordingNotifier());
    await expect(service.execute("job-1")).rejects.toThrow("Rate limit");
    await service.execute("job-1");
    expect(publisher.created).toHaveLength(0);
    expect(publisher.publishContainer).toHaveBeenLastCalledWith("container-existing");
    expect(repository.completed).toBe(true);
  });

  it("ignores cancelled jobs and preserves completion if notification fails", async () => {
    const repository = new InMemoryPublicationRepository(jobFixture());
    repository.job.status = "CANCELLED";
    const publisher = new RecordingPublisher();
    const notifier = new RecordingNotifier();
    vi.spyOn(notifier, "notifyPublished").mockRejectedValue(new Error("offline"));
    const service = new ProcessPublicationService(repository, publisher, notifier);
    await service.execute("job-1");
    expect(publisher.sent).toHaveLength(0);
    repository.job.status = "PENDING";
    await service.execute("job-1");
    expect(repository.completed).toBe(true);
  });
  it("continues from the failed segment without publishing completed segments again", async () => {
    const repository = new InMemoryPublicationRepository(jobFixture());
    const publisher = new RecordingPublisher();
    const notifier = new RecordingNotifier();
    const service = new ProcessPublicationService(repository, publisher, notifier);

    await service.execute("job-1");

    expect(publisher.created).toHaveLength(1);
    expect(publisher.created[0]).toMatchObject({
      segmentPosition: 1,
      replyToId: "media-0"
    });
    expect(repository.completed).toBe(true);
    expect(repository.job.segments.map((segment) => segment.status)).toEqual([
      "PUBLISHED",
      "PUBLISHED"
    ]);
    expect(notifier.published).toBe(1);
  });

  it("stops automatic retries when the publish result is ambiguous", async () => {
    const fixture = jobFixture();
    fixture.segments = [fixture.segments[1]!];
    fixture.status = "PENDING";
    const repository = new InMemoryPublicationRepository(fixture);
    const publisher = new RecordingPublisher();
    publisher.failAmbiguously = true;
    const notifier = new RecordingNotifier();
    const service = new ProcessPublicationService(repository, publisher, notifier);

    await service.execute("job-1");

    expect(repository.job.status).toBe("NEEDS_REVIEW");
    expect(repository.completed).toBe(false);
    expect(notifier.needsReview).toBe(1);
  });
});
