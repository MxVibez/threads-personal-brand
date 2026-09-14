import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";
import {
  ThreadsAnalyticsService,
  type ThreadsAnalyticsDashboard
} from "./threads-analytics.service";

export interface ThreadsResultsDashboard {
  counts: {
    waiting: number;
    approved: number;
    rejected: number;
    published: number;
    failed: number;
  };
  integrations: Array<{
    id: "telegram" | "apify" | "threads" | "ai";
    name: string;
    state: "working" | "setup" | "test";
    summary: string;
    detail: string;
    nextStep?: string;
  }>;
  insights: ThreadsAnalyticsDashboard;
}

@Injectable()
export class ThreadsResultsService {
  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly analytics: ThreadsAnalyticsService
  ) {}

  async dashboard(userTelegramId: string): Promise<ThreadsResultsDashboard> {
    const [drafts, publications, market, insights] = await Promise.all([
      this.pool.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count
         FROM drafts WHERE expert_telegram_id = $1
         GROUP BY status`,
        [userTelegramId]
      ),
      this.pool.query<{ status: string; count: string }>(
        `SELECT pj.status, COUNT(*)::text AS count
         FROM publication_jobs pj
         JOIN drafts d ON d.id = pj.draft_id
         WHERE d.expert_telegram_id = $1
         GROUP BY pj.status`,
        [userTelegramId]
      ),
      this.pool.query<{
        last_status: string | null;
        item_count: string;
        post_count: string;
        account_count: string;
        question_count: string;
      }>(
        `SELECT
           (SELECT status FROM market_monitor_runs ORDER BY started_at DESC LIMIT 1) AS last_status,
           COALESCE((SELECT item_count FROM market_monitor_runs ORDER BY started_at DESC LIMIT 1), 0)::text AS item_count,
           (SELECT COUNT(*) FROM market_posts)::text AS post_count,
           (SELECT COUNT(*) FROM market_accounts)::text AS account_count,
           (SELECT COUNT(*) FROM market_posts WHERE position(chr(63) in text) > 0)::text AS question_count`
      ),
      this.analytics.dashboard()
    ]);

    const draftCount = this.countMap(drafts.rows);
    const publicationCount = this.countMap(publications.rows);
    const threadsConfigured = Boolean(
      this.config.get<string>("THREADS_USER_ID", "") &&
      this.config.get<string>("THREADS_ACCESS_TOKEN", "")
    );
    const dryRun = this.config.get<string>("THREADS_DRY_RUN", "true") === "true";
    const apifyTokenConfigured = Boolean(this.config.get<string>("APIFY_API_TOKEN", ""));
    const apifyActorConfigured = Boolean(this.config.get<string>("APIFY_ACTOR_ID", ""));
    const apifyConfigured = apifyTokenConfigured && apifyActorConfigured;
    const marketEnabled = this.config.get<string>("APIFY_MARKET_ENABLED", "false") === "true";
    const threadsMarketEnabled = this.config.get<string>("THREADS_MARKET_ENABLED", "false") === "true";
    const officialMarketConfigured = threadsConfigured && threadsMarketEnabled;
    const marketStatus = market.rows[0];
    const marketPosts = Number(marketStatus?.post_count ?? "0");
    const marketAccounts = Number(marketStatus?.account_count ?? "0");
    const marketQuestions = Number(marketStatus?.question_count ?? "0");
    const aiConfigured = Boolean(this.config.get<string>("OPENAI_API_KEY", ""));

    return {
      counts: {
        waiting: draftCount.get("WAITING_APPROVAL") ?? 0,
        approved: draftCount.get("APPROVED") ?? 0,
        rejected: draftCount.get("REJECTED") ?? 0,
        published: publicationCount.get("PUBLISHED") ?? 0,
        failed:
          (publicationCount.get("FAILED") ?? 0) +
          (publicationCount.get("PARTIAL_FAILED") ?? 0) +
          (publicationCount.get("NEEDS_REVIEW") ?? 0)
      },
      integrations: [
        {
          id: "telegram",
          name: "Telegram",
          state: "working",
          summary: "Бот и Mini App работают",
          detail: "Telegram проверяет пользователя, доставляет уведомления и открывает Mini App."
        },
        {
          id: "apify",
          name: "Поиск тем в Threads",
          state: officialMarketConfigured && ["RUNNING", "SUCCEEDED"].includes(marketStatus?.last_status ?? "")
            ? "working"
            : officialMarketConfigured
              ? "test"
              : apifyConfigured && marketEnabled
                ? "working"
                : apifyTokenConfigured
                  ? "test"
                  : "setup",
          summary: officialMarketConfigured
            ? marketStatus?.last_status === "RUNNING" ? "Идёт поиск свежих тем"
              : marketStatus?.last_status === "FAILED" ? "Последний поиск завершился ошибкой"
              : marketStatus?.last_status === "SUCCEEDED" ? "Ежедневный поиск работает" : "Ожидается первый поиск"
            : apifyConfigured && marketEnabled
            ? marketStatus?.last_status === "RUNNING" ? "Идёт сбор рынка"
              : marketStatus?.last_status === "FAILED" ? "Последний сбор завершился ошибкой"
              : marketStatus?.last_status === "SUCCEEDED" ? "Последний сбор завершён" : "Ожидается первый сбор"
            : apifyConfigured
              ? "Apify настроен, мониторинг выключен"
            : apifyTokenConfigured
              ? "Apify API подключён"
              : "Apify API ещё не подключён",
          detail: officialMarketConfigured
            ? `Сохранено ${marketPosts} публикаций от ${marketAccounts} авторов. Бот уведомляет только о новых найденных темах.`
            : apifyConfigured && marketEnabled
            ? `Сохранено ${marketPosts} публикаций от ${marketAccounts} авторов. Найдено ${marketQuestions} публикаций с вопросами.`
            : apifyConfigured
              ? "API-токен и Actor настроены, но ежедневный сбор выключен."
            : apifyTokenConfigured
              ? "Токен проверен и сохранён. Actor, расписание и сбор данных подключим позже."
              : "Система пока не подключена к Apify и не собирает публичные обсуждения.",
          ...(!(officialMarketConfigured || (apifyConfigured && marketEnabled))
            ? {
                nextStep: threadsConfigured
                  ? "Включить поиск тем через Threads API."
                  : apifyConfigured
                  ? "Включить ежедневный мониторинг."
                  : apifyTokenConfigured
                    ? "Выбрать Actor и настроить источники."
                  : "Добавить API-токен Apify."
              }
            : {})
        },
        {
          id: "threads",
          name: "Публикация и аналитика Threads",
          state: threadsConfigured && !dryRun ? "working" : threadsConfigured ? "test" : "setup",
          summary: threadsConfigured
            ? dryRun ? "Подключено, но включён тест" : "Threads подключён"
            : "Threads API ещё не подключён",
          detail: dryRun
            ? "Одобрения сохраняются, но реальные посты не отправляются до контрольной проверки подключения."
            : "Одобренные материалы публикуются через Threads API, статистика аккаунта обновляется отдельно.",
          ...(threadsConfigured
            ? dryRun ? { nextStep: "После контрольного поста выключить dry-run." } : {}
            : { nextStep: "Подключить Threads с правом просмотра статистики." })
        },
        {
          id: "ai",
          name: "Нейросеть и голос",
          state: aiConfigured ? "test" : "setup",
          summary: aiConfigured ? "Ключ сохранён, генерация ещё не настроена" : "OpenAI API ещё не подключён",
          detail: aiConfigured
            ? "Ключ сохранён на сервере. Генерация из рыночных данных и проверка голоса ещё не реализованы."
            : "Автоматическая генерация и оценка материалов пока не запускаются.",
          nextStep: aiConfigured
            ? "Подключить генерацию и затем провести калибровку на текстах эксперта."
            : "Добавить API key и примеры текстов эксперта."
        }
      ],
      insights
    };
  }

  private countMap(rows: Array<{ status: string; count: string }>): Map<string, number> {
    return new Map(rows.map((row) => [row.status, Number(row.count)]));
  }
}
