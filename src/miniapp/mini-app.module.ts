import { Module } from "@nestjs/common";
import { ApproveDraftService } from "../domain/drafts/approve-draft.service";
import { MiniAppController } from "./mini-app.controller";
import { TelegramMiniAppAuthService } from "./telegram-mini-app-auth.service";
import { ExpertSettingsService } from "./expert-settings.service";

@Module({
  controllers: [MiniAppController],
  providers: [ApproveDraftService, TelegramMiniAppAuthService, ExpertSettingsService]
})
export class MiniAppModule {}
