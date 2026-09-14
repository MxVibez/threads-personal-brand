import { Module } from "@nestjs/common";
import { ApproveDraftService } from "../domain/drafts/approve-draft.service";
import { TelegramBotService } from "./telegram-bot.service";
import { TelegramWebhookController } from "./telegram-webhook.controller";

@Module({
  controllers: [TelegramWebhookController],
  providers: [ApproveDraftService, TelegramBotService],
  exports: [TelegramBotService]
})
export class TelegramModule {}
