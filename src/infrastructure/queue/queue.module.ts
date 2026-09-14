import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import {
  PUBLICATION_QUEUE,
  PUBLISH_DRAFT_QUEUE_NAME
} from "../../domain/publication/publication-queue";
import { BullPublicationQueue } from "./bull-publication.queue";
import { redisConnectionFromUrl } from "./redis-connection";
import { BULL_PUBLICATION_QUEUE } from "./queue.tokens";

@Injectable()
class QueueShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(BULL_PUBLICATION_QUEUE)
    private readonly queue: Queue<{ publicationJobId: string }>
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: BULL_PUBLICATION_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue<{ publicationJobId: string }>(PUBLISH_DRAFT_QUEUE_NAME, {
          connection: redisConnectionFromUrl(config.getOrThrow<string>("REDIS_URL"))
        })
    },
    BullPublicationQueue,
    QueueShutdown,
    { provide: PUBLICATION_QUEUE, useExisting: BullPublicationQueue }
  ],
  exports: [PUBLICATION_QUEUE, BULL_PUBLICATION_QUEUE]
})
export class QueueModule {}
