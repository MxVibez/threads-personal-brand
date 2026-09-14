import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  PUBLICATION_NOTIFIER,
  type PublicationNotifier
} from "./publication-notifier";
import {
  PUBLICATION_REPOSITORY,
  type PublicationRepository
} from "./publication.repository";
import {
  THREADS_PUBLISHER,
  ThreadsPublishError,
  type ThreadsPublisher
} from "./threads-publisher";

@Injectable()
export class ProcessPublicationService {
  private readonly logger = new Logger(ProcessPublicationService.name);
  constructor(
    @Inject(PUBLICATION_REPOSITORY)
    private readonly publications: PublicationRepository,
    @Inject(THREADS_PUBLISHER) private readonly threads: ThreadsPublisher,
    @Inject(PUBLICATION_NOTIFIER) private readonly notifier: PublicationNotifier
  ) {}

  async execute(publicationJobId: string): Promise<void> {
    const job = await this.publications.claimJob(publicationJobId);
    if (!job) return;
    if (job.dryRun !== this.threads.dryRun) {
      const segment = job.segments[0];
      if (segment) await this.requireReview(job.expertTelegramId, publicationJobId, segment.id,
        "Режим публикации изменился после одобрения. Требуется новое согласование.");
      return;
    }

    let replyToId: string | null = null;
    const mediaIds: string[] = [];

    for (const segment of job.segments) {
      if (segment.status === "PUBLISHED" && segment.threadsMediaId) {
        replyToId = segment.threadsMediaId;
        mediaIds.push(segment.threadsMediaId);
        continue;
      }
      if (segment.status === "NEEDS_REVIEW" || segment.status === "PUBLISHING") {
        await this.requireReview(job.expertTelegramId, publicationJobId, segment.id,
          "Предыдущая отправка прервалась. Проверьте наличие поста в Threads перед повтором.");
        return;
      }

      let publishStarted = false;
      try {
        let containerId = segment.threadsContainerId;
        if (!containerId) {
          containerId = await this.threads.createTextContainer({
            publicationJobId,
            segmentPosition: segment.position,
            text: segment.text,
            replyToId
          });
          await this.publications.saveContainer(segment.id, containerId);
        }

        await this.publications.markSegmentPublishing(segment.id);
        publishStarted = true;
        let mediaId: string;
        try {
          mediaId = await this.threads.publishContainer(containerId);
        } catch (error) {
          // Only an explicit API rejection proves it is safe to retry.
          if (error instanceof ThreadsPublishError && !error.ambiguous) publishStarted = false;
          throw error;
        }

        await this.publications.markSegmentPublished(segment.id, mediaId);
        mediaIds.push(mediaId);
        replyToId = mediaId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown publish error";
        if (publishStarted) {
          // Includes a successful API response followed by a database write failure.
          await this.requireReview(job.expertTelegramId, publicationJobId, segment.id, message);
          return;
        }
        await this.publications.markSegmentFailed(segment.id, message);
        throw error;
      }
    }

    await this.publications.markJobCompleted(publicationJobId);
    await this.notifier.notifyPublished({
      expertTelegramId: job.expertTelegramId,
      publicationJobId,
      mediaIds,
      dryRun: this.threads.dryRun
    }).catch(() => this.logger.warn(`Publication ${publicationJobId} completed; notification failed`));
  }

  private async requireReview(expertTelegramId: string, publicationJobId: string, segmentId: string, reason: string): Promise<void> {
    await this.publications.markSegmentNeedsReview(segmentId, reason);
    await this.notifier.notifyNeedsReview({ expertTelegramId, publicationJobId, reason })
      .catch(() => this.logger.warn(`Publication ${publicationJobId} needs review; notification failed`));
  }
}
