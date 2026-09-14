import { timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  TELEGRAM_UPDATE_STORE,
  type TelegramUpdateStore
} from "../infrastructure/database/telegram-update.store";
import { TelegramBotService } from "./telegram-bot.service";

interface TelegramUpdatePayload {
  update_id: number;
  [key: string]: unknown;
}

function isTelegramUpdate(value: unknown): value is TelegramUpdatePayload {
  const updateId = (value as { update_id?: unknown } | null)?.update_id;
  return (
    typeof value === "object" &&
    value !== null &&
    "update_id" in value &&
    typeof updateId === "number" &&
    Number.isSafeInteger(updateId) &&
    updateId >= 0
  );
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

@Controller("webhooks/telegram")
export class TelegramWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly bot: TelegramBotService,
    @Inject(TELEGRAM_UPDATE_STORE)
    private readonly updates: TelegramUpdateStore
  ) {}

  @Post()
  async receive(
    @Headers("x-telegram-bot-api-secret-token") webhookSecret: string | undefined,
    @Body() body: unknown
  ): Promise<{ ok: true; duplicate?: true }> {
    const botToken = this.config.get<string>("TELEGRAM_BOT_TOKEN", "");
    if (!botToken) {
      throw new ServiceUnavailableException("Telegram integration is disabled");
    }

    const expectedSecret = this.config.get<string>("TELEGRAM_WEBHOOK_SECRET", "");
    if (!secretsMatch(webhookSecret, expectedSecret)) {
      throw new UnauthorizedException("Invalid Telegram webhook secret");
    }
    if (!isTelegramUpdate(body)) {
      throw new BadRequestException("Invalid Telegram update");
    }

    const claimed = await this.updates.claim(body.update_id);
    if (!claimed) return { ok: true, duplicate: true };

    try {
      await this.bot.handleUpdate(body);
      await this.updates.markProcessed(body.update_id);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Telegram error";
      await this.updates.markFailed(body.update_id, message);
      throw error;
    }
  }
}
