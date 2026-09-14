import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { z } from "zod";
import { DraftAccessDeniedError, DraftNotFoundError, DraftStateError, DraftVersionConflictError } from "../domain/drafts/draft.errors";
import {
  TelegramAccessService,
  type AccessApplicant
} from "../access/telegram-access.service";
import { ApproveDraftService } from "../domain/drafts/approve-draft.service";
import {
  DRAFT_REPOSITORY,
  type DraftRepository
} from "../domain/drafts/draft.repository";
import type { DraftView } from "../domain/drafts/draft.types";

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly approveDraft: ApproveDraftService,
    private readonly access: TelegramAccessService,
    @Inject(DRAFT_REPOSITORY) private readonly drafts: DraftRepository
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>("TELEGRAM_BOT_TOKEN", "");
    if (!token) return;

    const bot = new Bot(token);
    bot.use(async (context, next) => {
      if (context.chat?.type === "private") await next();
    });
    bot.command("start", async (context) => this.handleStart(context));
    bot.command("demo", async (context) => this.handleDemo(context));
    bot.command("admin", async (context) => this.handleAdmin(context));
    bot.on("callback_query:data", async (context) => this.handleCallback(context));
    await bot.init();
    this.bot = bot;
    await this.configureBotMenu(bot);
  }

  async handleUpdate(update: unknown): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot is not configured");
    await this.bot.handleUpdate(update as Parameters<Bot["handleUpdate"]>[0]);
  }

  private async handleStart(context: Context): Promise<void> {
    const telegramId = this.telegramId(context);
    if (!telegramId) return;

    if (await this.access.canUseMiniApp(telegramId)) {
      const miniAppUrl = this.miniAppUrl();
      if (!miniAppUrl) {
        await context.reply(
          "Бот подключён, но адрес Mini App пока не настроен. Команда /demo создаст тестовую ветку."
        );
        return;
      }

      await this.configureUserMenu(telegramId, true);
      await this.ensureDemoDraft(telegramId);
      const keyboard = this.miniAppWelcomeKeyboard(
        miniAppUrl,
        this.access.isOwner(telegramId)
      );
      try {
        await context.replyWithPhoto(this.miniAppBannerUrl(miniAppUrl), {
          caption: this.miniAppWelcomeText(),
          reply_markup: keyboard
        });
      } catch (error) {
        this.logger.warn(`Не удалось отправить welcome-баннер: ${this.userFacingError(error)}`);
        await context.reply(this.miniAppWelcomeText(), { reply_markup: keyboard });
      }
      return;
    }

    const sourceCode = context.message?.text?.split(/\s+/, 2)[1];
    if (sourceCode === "tester") {
      const keyboard = new InlineKeyboard().text(
        "Запросить тестовый доступ",
        "access:request"
      );
      await context.reply(
        "Это тестовый доступ к Threads-пульту. Отправьте запрос — владелец бота увидит ваше имя и Telegram ID и решит, открыть ли доступ.",
        { reply_markup: keyboard }
      );
      return;
    }
    await context.reply(
      "Это рабочий бот для управления Threads-контентом. Доступ выдаёт владелец. Если вас пригласили на тест, откройте его ссылку-приглашение."
    );
  }

  private async handleDemo(context: Context): Promise<void> {
    const telegramId = this.telegramId(context);
    if (!telegramId || !(await this.access.canUseMiniApp(telegramId))) {
      await context.reply("Сначала запросите тестовый доступ у владельца бота.");
      return;
    }

    if (!this.access.canMutateWorkspace(telegramId)) {
      await context.reply("В рабочем режиме менять общий контент может только владелец.");
      return;
    }

    const workspaceTelegramId = this.access.workspaceTelegramId();
    const waiting = await this.drafts.listWaitingByExpert(workspaceTelegramId, 1);
    const draft = waiting[0] ?? await this.drafts.createDemo(workspaceTelegramId);
    await this.sendDraftCard(context, draft);
  }

  private async handleCallback(context: Context): Promise<void> {
    const telegramId = this.telegramId(context);
    const data = context.callbackQuery?.data;
    if (!telegramId || !data) return;

    if (data === "access:request") {
      await this.handleAccessRequest(context, telegramId);
      return;
    }

    if (data === "admin:open") {
      await context.answerCallbackQuery();
      await this.sendAdminPanel(context, telegramId);
      return;
    }

    if (data.startsWith("access:grant:") || data.startsWith("access:deny:")) {
      await this.handleAccessDecision(context, telegramId, data);
      return;
    }

    if (data.startsWith("access:revoke:")) {
      await this.handleAccessRevoke(context, telegramId, data);
      return;
    }

    if (!(await this.access.canUseMiniApp(telegramId))) {
      await context.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
      return;
    }

    const workspaceTelegramId = this.access.workspaceTelegramId();

    const [action, draftId, versionText] = data.split(":");
    const version = Number(versionText);
    if (!draftId || !z.string().uuid().safeParse(draftId).success || !Number.isSafeInteger(version) || version < 1) {
      await context.answerCallbackQuery({ text: "Кнопка устарела", show_alert: true });
      return;
    }

    if (action === "approve") {
      if (!this.access.canMutateWorkspace(telegramId)) {
        await context.answerCallbackQuery({
          text: "В рабочем режиме одобрять может только владелец",
          show_alert: true
        });
        return;
      }
      await context.answerCallbackQuery({ text: "Ставлю публикацию в очередь" });
      try {
        const result = await this.approveDraft.execute({
          draftId,
          expectedVersion: version,
          expertTelegramId: workspaceTelegramId,
          actorTelegramId: telegramId
        });
        await context.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        const message = result.alreadyApproved
          ? "Эта версия уже одобрена. Повторная публикация не создана."
          : "Версия одобрена. Публикация поставлена в очередь.";
        await context.reply(`${message}\nЗадание: ${result.publicationJob.id}`);
      } catch (error) {
        await context.reply(this.userFacingError(error));
      }
      return;
    }

    if (action === "sources") {
      await context.answerCallbackQuery();
      const draft = await this.drafts.findById(draftId);
      if (!draft || draft.expertTelegramId !== workspaceTelegramId) {
        await context.reply("Черновик или его источники недоступны.");
        return;
      }
      const sources = draft.sources
        .map((source, index) => `${index + 1}. ${source.label}\n${source.url}`)
        .join("\n\n");
      await context.reply(sources || "У этого черновика пока нет источников.");
      return;
    }

    if (action === "reject") {
      if (!this.access.canMutateWorkspace(telegramId)) {
        await context.answerCallbackQuery({
          text: "В рабочем режиме отклонять может только владелец",
          show_alert: true
        });
        return;
      }
      await context.answerCallbackQuery({ text: "Черновик отклонён" });
      try {
        await this.drafts.reject({
          draftId,
          expectedVersion: version,
          expertTelegramId: workspaceTelegramId,
          actorTelegramId: telegramId,
          reason: "Отклонено из карточки без комментария"
        });
        await context.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        await context.reply("Черновик отклонён. Сбор причины добавим вместе с редактором.");
      } catch (error) {
        await context.reply(this.userFacingError(error));
      }
    }
  }

  private async sendDraftCard(context: Context, draft: DraftView): Promise<void> {
    const content = draft.segments
      .map((segment, index) => `${index + 1}/${draft.segments.length}\n${segment}`)
      .join("\n\n");
    const keyboard = new InlineKeyboard()
      .text("Источники", `sources:${draft.id}:${draft.currentVersion}`)
      .row()
      .text(
        "Одобрить и выложить",
        `approve:${draft.id}:${draft.currentVersion}`
      )
      .row()
      .text("Отклонить", `reject:${draft.id}:${draft.currentVersion}`);

    await context.reply(
      `Черновик · ветка из ${draft.segments.length} сообщений\n` +
        `Тема: ${draft.title}\n` +
        `Версия: ${draft.currentVersion}\n\n${content}`,
      { reply_markup: keyboard }
    );
  }

  private telegramId(context: Context): string | null {
    return context.from?.id ? String(context.from.id) : null;
  }

  private miniAppUrl(): string | null {
    const baseUrl = this.config.get<string>("APP_BASE_URL", "").trim();
    return baseUrl ? `${baseUrl.replace(/\/$/, "")}/miniapp/` : null;
  }

  private async configureBotMenu(bot: Bot): Promise<void> {
    const miniAppUrl = this.miniAppUrl();
    if (!miniAppUrl) return;

    try {
      await bot.api.setMyCommands([
        { command: "start", description: "Открыть пульт" },
        { command: "demo", description: "Добавить тестовую ветку" }
      ]);
      for (const ownerId of this.access.ownerIds()) {
        await bot.api.setMyCommands(
          [
            { command: "start", description: "Открыть пульт" },
            { command: "demo", description: "Добавить тестовую ветку" },
            { command: "admin", description: "Управление доступом" }
          ],
          { scope: { type: "chat", chat_id: ownerId } }
        );
      }
      await bot.api.setChatMenuButton({
        menu_button: { type: "commands" }
      });
      for (const ownerId of this.access.ownerIds()) {
        await this.configureUserMenu(ownerId, true, bot);
      }
    } catch (error) {
      this.logger.warn(
        `Не удалось обновить меню Telegram: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`
      );
    }
  }

  private async handleAdmin(context: Context): Promise<void> {
    const telegramId = this.telegramId(context);
    if (!telegramId) return;
    await this.sendAdminPanel(context, telegramId);
  }

  private async sendAdminPanel(context: Context, ownerTelegramId: string): Promise<void> {
    if (!this.access.isOwner(ownerTelegramId)) {
      await context.reply("Админка доступна только владельцу бота.");
      return;
    }

    const [pending, testers] = await Promise.all([
      this.access.listPendingRequests(),
      this.access.listActiveTesters()
    ]);
    const botUsername = this.bot?.botInfo.username;
    const inviteLink = botUsername
      ? `https://t.me/${botUsername}?start=tester`
      : "Ссылка появится после перезапуска бота";
    const lines = [
      "Доступ к тестированию",
      "",
      `Ждут решения: ${pending.length}`,
      `Активные тестировщики: ${testers.length}`,
      "",
      "Ссылка для приглашения:",
      inviteLink
    ];
    const keyboard = new InlineKeyboard();

    for (const request of pending) {
      const label = this.shortUserLabel(request);
      keyboard
        .text(`Разрешить · ${label}`, `access:grant:${request.id}`)
        .text("Отклонить", `access:deny:${request.id}`)
        .row();
    }
    for (const tester of testers) {
      keyboard
        .text(
          `Закрыть доступ · ${this.shortUserLabel(tester)}`,
          `access:revoke:${tester.telegramId}`
        )
        .row();
    }
    if (pending.length === 0 && testers.length === 0) {
      lines.push("", "Пока никого нет. Отправьте человеку ссылку выше.");
    }

    await context.reply(lines.join("\n"), { reply_markup: keyboard });
  }

  private async handleAccessRequest(
    context: Context,
    telegramId: string
  ): Promise<void> {
    let result: Awaited<ReturnType<TelegramAccessService["requestAccess"]>>;
    try {
      result = await this.access.requestAccess(
        this.applicantFromContext(context, telegramId)
      );
    } catch (error) {
      await context.answerCallbackQuery({
        text: this.userFacingError(error),
        show_alert: true
      });
      return;
    }

    await context.answerCallbackQuery({
      text: result.created ? "Запрос отправлен" : "Запрос уже ждёт решения"
    });
    if (!result.created) return;

    const request = result.request;
    const keyboard = new InlineKeyboard()
      .text("Разрешить", `access:grant:${request.id}`)
      .text("Отклонить", `access:deny:${request.id}`);
    const username = request.username ? `@${request.username}` : "без username";
    const message =
      `Новый запрос на тестовый доступ\n\n` +
      `${request.displayName}\n${username}\nTelegram ID: ${request.telegramId}`;
    for (const ownerId of this.access.ownerIds()) {
      try {
        await context.api.sendMessage(ownerId, message, { reply_markup: keyboard });
      } catch (error) {
        this.logger.warn(
          `Не удалось уведомить владельца ${ownerId}: ${this.userFacingError(error)}`
        );
      }
    }
    try {
      await context.reply("Запрос отправлен владельцу. Бот напишет, когда доступ откроют.");
    } catch (error) {
      this.logger.warn(`Не удалось подтвердить запрос пользователю: ${this.userFacingError(error)}`);
    }
  }

  private async handleAccessDecision(
    context: Context,
    ownerTelegramId: string,
    data: string
  ): Promise<void> {
    if (!this.access.isOwner(ownerTelegramId)) {
      await context.answerCallbackQuery({ text: "Нет прав", show_alert: true });
      return;
    }
    const [, action, requestId] = data.split(":");
    if (!requestId || !z.string().uuid().safeParse(requestId).success) {
      await context.answerCallbackQuery({ text: "Кнопка устарела", show_alert: true });
      return;
    }
    const approved = action === "grant";
    let result: Awaited<ReturnType<TelegramAccessService["decideRequest"]>>;
    try {
      result = await this.access.decideRequest(
        ownerTelegramId,
        requestId,
        approved ? "APPROVED" : "REJECTED"
      );
    } catch (error) {
      await context.answerCallbackQuery({
        text: this.userFacingError(error),
        show_alert: true
      });
      return;
    }

    const accessGranted = result.request.status === "APPROVED";
    await context.answerCallbackQuery({
      text: result.alreadyDecided
        ? "Решение уже сохранено"
        : accessGranted
          ? "Доступ открыт"
          : "Запрос отклонён"
    });
    await context.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    if (result.alreadyDecided) return;

    if (accessGranted) {
      try {
        await this.ensureDemoDraft(result.request.telegramId);
      } catch (error) {
        this.logger.warn(
          `Не удалось создать демо для ${result.request.telegramId}: ${this.userFacingError(error)}`
        );
      }
      await this.configureUserMenu(result.request.telegramId, true);
    }
    const miniAppUrl = this.miniAppUrl();
    const keyboard = accessGranted && miniAppUrl
      ? this.miniAppWelcomeKeyboard(miniAppUrl, false)
      : undefined;
    try {
      if (accessGranted && miniAppUrl && keyboard) {
        await context.api.sendPhoto(
          result.request.telegramId,
          this.miniAppBannerUrl(miniAppUrl),
          { caption: this.miniAppWelcomeText(), reply_markup: keyboard }
        );
      } else {
        await context.api.sendMessage(
          result.request.telegramId,
          "Владелец пока не открыл тестовый доступ."
        );
      }
    } catch (error) {
      this.logger.warn(
        `Не удалось уведомить тестировщика ${result.request.telegramId}: ${this.userFacingError(error)}`
      );
      if (accessGranted && keyboard) {
        try {
          await context.api.sendMessage(
            result.request.telegramId,
            this.miniAppWelcomeText(),
            { reply_markup: keyboard }
          );
        } catch (fallbackError) {
          this.logger.warn(
            `Не удалось отправить текстовое уведомление тестировщику ${result.request.telegramId}: ${this.userFacingError(fallbackError)}`
          );
        }
      }
    }
  }

  private async handleAccessRevoke(
    context: Context,
    ownerTelegramId: string,
    data: string
  ): Promise<void> {
    if (!this.access.isOwner(ownerTelegramId)) {
      await context.answerCallbackQuery({ text: "Нет прав", show_alert: true });
      return;
    }
    const testerTelegramId = data.split(":")[2];
    if (!testerTelegramId || !/^\d+$/.test(testerTelegramId)) {
      await context.answerCallbackQuery({ text: "Кнопка устарела", show_alert: true });
      return;
    }
    let revoked: boolean;
    try {
      revoked = await this.access.revokeTester(ownerTelegramId, testerTelegramId);
    } catch (error) {
      await context.answerCallbackQuery({
        text: this.userFacingError(error),
        show_alert: true
      });
      return;
    }

    await context.answerCallbackQuery({
      text: revoked ? "Доступ закрыт" : "Доступ уже был закрыт"
    });
    await context.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    if (revoked) {
      await this.configureUserMenu(testerTelegramId, false);
      try {
        await context.api.sendMessage(
          testerTelegramId,
          "Тестовый доступ к Threads-пульту закрыт владельцем."
        );
      } catch (error) {
        this.logger.warn(
          `Не удалось уведомить тестировщика ${testerTelegramId}: ${this.userFacingError(error)}`
        );
      }
    }
  }

  private async ensureDemoDraft(telegramId: string): Promise<void> {
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const waitingDrafts = await this.drafts.listWaitingByExpert(workspaceTelegramId, 1);
    if (waitingDrafts.length === 0 && this.access.canMutateWorkspace(telegramId)) {
      await this.drafts.createDemo(workspaceTelegramId);
    }
  }

  private miniAppWelcomeKeyboard(
    miniAppUrl: string,
    includeAdmin: boolean
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard().webApp(
      { text: "Threads-пульт", style: "primary" },
      miniAppUrl
    );
    if (includeAdmin) {
      keyboard.row().text("Управление доступом", "admin:open");
    }
    return keyboard;
  }

  private miniAppBannerUrl(miniAppUrl: string): string {
    return `${miniAppUrl.replace(/\/?$/, "/")}brand-banner-placeholder.svg`;
  }

  private miniAppWelcomeText(): string {
    return [
      "В Threads-пульте можно:",
      "• проверить готовые посты;",
      "• одобрить, отклонить или выбрать время;",
      "• посмотреть план публикаций;",
      "• проверить результаты и состояние публикаций.",
      "",
      "Сейчас работает тестовый режим. В Threads ничего не публикуется."
    ].join("\n");
  }

  private async configureUserMenu(
    telegramId: string,
    enabled: boolean,
    targetBot = this.bot
  ): Promise<void> {
    if (!targetBot) return;
    const miniAppUrl = this.miniAppUrl();
    if (enabled && !miniAppUrl) return;
    try {
      await targetBot.api.setChatMenuButton({
        chat_id: Number(telegramId),
        menu_button: enabled
          ? {
              type: "web_app",
              text: "Threads-пульт",
              web_app: { url: miniAppUrl! }
            }
          : { type: "commands" }
      });
    } catch (error) {
      this.logger.warn(
        `Не удалось обновить меню пользователя ${telegramId}: ${this.userFacingError(error)}`
      );
    }
  }

  private applicantFromContext(context: Context, telegramId: string): AccessApplicant {
    const from = context.from;
    const displayName = [from?.first_name, from?.last_name]
      .filter(Boolean)
      .join(" ") || from?.username || `ID ${telegramId}`;
    return {
      telegramId,
      displayName,
      ...(from?.username ? { username: from.username } : {})
    };
  }

  private shortUserLabel(user: AccessApplicant): string {
    const value = user.username ? `@${user.username}` : user.displayName;
    return value.length > 24 ? `${value.slice(0, 23)}…` : value;
  }

  private userFacingError(error: unknown): string {
    if (error instanceof DraftAccessDeniedError || error instanceof DraftNotFoundError ||
        error instanceof DraftStateError || error instanceof DraftVersionConflictError) return error.message;
    return "Не удалось выполнить действие. Черновик сохранён, попробуйте ещё раз.";
  }
}
