import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { ProcessPublicationService } from "../domain/publication/process-publication.service";
import { PUBLISH_DRAFT_QUEUE_NAME } from "../domain/publication/publication-queue";
import { redisConnectionFromUrl } from "../infrastructure/queue/redis-connection";

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private worker: Worker<{ publicationJobId: string }> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly processPublication: ProcessPublicationService
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<{ publicationJobId: string }>(
      PUBLISH_DRAFT_QUEUE_NAME,
      async (job) => this.processPublication.execute(job.data.publicationJobId),
      {
        connection: redisConnectionFromUrl(this.config.getOrThrow<string>("REDIS_URL")),
        concurrency: 2,
        lockDuration: 60_000
      }
    );
    this.worker.on("error", () => this.logger.error("Publication worker connection failed"));
    this.worker.on("failed", (job) => this.logger.warn(`Publication job ${job?.id ?? "unknown"} failed`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
