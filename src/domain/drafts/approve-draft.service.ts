import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DRAFT_REPOSITORY,
  type ApproveDraftInput,
  type DraftRepository
} from "./draft.repository";
import type { ApprovalResult } from "./draft.types";
import {
  PUBLICATION_QUEUE,
  type PublicationQueue
} from "../publication/publication-queue";

@Injectable()
export class ApproveDraftService {
  constructor(
    @Inject(DRAFT_REPOSITORY) private readonly drafts: DraftRepository,
    @Inject(PUBLICATION_QUEUE) private readonly publicationQueue: PublicationQueue,
    @Optional() private readonly config?: ConfigService
  ) {}

  async execute(input: ApproveDraftInput): Promise<ApprovalResult> {
    const result = await this.drafts.approve({ ...input, dryRun: this.config?.get<string>("THREADS_DRY_RUN", "true") !== "false" });

    // Повторная постановка безопасна: BullMQ получает publicationJobId как jobId.
    // Это также восстанавливает задачу, если база успела записать одобрение,
    // а Redis был временно недоступен.
    if (result.publicationJob.status === "PENDING") await this.publicationQueue.enqueue(
      result.publicationJob.id,
      result.publicationJob.scheduledAt
    );

    return result;
  }
}
