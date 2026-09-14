import { Global, Module } from "@nestjs/common";
import { TelegramAccessService } from "./telegram-access.service";

@Global()
@Module({
  providers: [TelegramAccessService],
  exports: [TelegramAccessService]
})
export class TelegramAccessModule {}
