import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { validateEnv } from "../config/env";
import {
  PUBLICATION_NOTIFIER
} from "../domain/publication/publication-notifier";
import { ProcessPublicationService } from "../domain/publication/process-publication.service";
import { THREADS_PUBLISHER } from "../domain/publication/threads-publisher";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { TelegramPublicationNotifier } from "../infrastructure/telegram/telegram-publication.notifier";
import { DryRunThreadsPublisher } from "../infrastructure/threads/dry-run-threads.publisher";
import { ThreadsApiPublisher } from "../infrastructure/threads/threads-api.publisher";
import { MarketMonitorService } from "../market/market-monitor.service";
import { WorkerRuntimeService } from "./worker-runtime.service";
import { QueueModule } from "../infrastructure/queue/queue.module";
import { PublicationRecoveryService } from "./publication-recovery.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    QueueModule
  ],
  providers: [
    ProcessPublicationService,
    WorkerRuntimeService,
    PublicationRecoveryService,
    MarketMonitorService,
    TelegramPublicationNotifier,
    { provide: PUBLICATION_NOTIFIER, useExisting: TelegramPublicationNotifier },
    {
      provide: THREADS_PUBLISHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dryRun = config.get<string>("THREADS_DRY_RUN", "true") === "true";
        if (dryRun) return new DryRunThreadsPublisher();

        return new ThreadsApiPublisher({
          baseUrl: config.getOrThrow<string>("THREADS_API_BASE_URL"),
          version: config.getOrThrow<string>("THREADS_API_VERSION"),
          userId: config.getOrThrow<string>("THREADS_USER_ID"),
          accessToken: config.getOrThrow<string>("THREADS_ACCESS_TOKEN")
        });
      }
    }
  ]
})
export class WorkerModule {}
