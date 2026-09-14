import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PublicationNotifier } from "../../domain/publication/publication-notifier";

@Injectable()
export class TelegramPublicationNotifier implements PublicationNotifier {
  constructor(private readonly config: ConfigService) {}

  async notifyPublished(input: {
    expertTelegramId: string;
    publicationJobId: string;
    mediaIds: string[];
    dryRun: boolean;
  }): Promise<void> {
    const heading = input.dryRun
      ? "Тест завершён. Threads API не вызывался."
      : "Ветка опубликована в Threads.";
    await this.sendMessage(
      input.expertTelegramId,
      `${heading}\nЗадание: ${input.publicationJobId}\nСегментов: ${input.mediaIds.length}`
    );
  }

  async notifyNeedsReview(input: {
    expertTelegramId: string;
    publicationJobId: string;
    reason: string;
  }): Promise<void> {
    await this.sendMessage(
      input.expertTelegramId,
      `Публикацию нельзя безопасно повторить автоматически.\n` +
        `Задание: ${input.publicationJobId}\nПричина: ${input.reason}`
    );
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const token = this.config.get<string>("TELEGRAM_BOT_TOKEN", "");
    if (!token) return;

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`Telegram notification failed with HTTP ${response.status}`);
    }
  }
}
