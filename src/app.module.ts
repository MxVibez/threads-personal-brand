import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { HealthController } from "./health.controller";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { QueueModule } from "./infrastructure/queue/queue.module";
import { TelegramModule } from "./telegram/telegram.module";
import { MiniAppModule } from "./miniapp/mini-app.module";
import { TelegramAccessModule } from "./access/telegram-access.module";
import { ThreadsResultsModule } from "./results/threads-results.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    TelegramAccessModule,
    ThreadsResultsModule,
    QueueModule,
    MiniAppModule,
    TelegramModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
