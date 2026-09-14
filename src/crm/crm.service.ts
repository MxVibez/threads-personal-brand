import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "WON",
  "LOST"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadView {
  id: string;
  telegramId: string;
  displayName: string;
  username?: string;
  sourceCode?: string;
  status: LeadStatus;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LeadRow {
  id: string;
  telegram_id: string;
  display_name: string | null;
  username: string | null;
  source_code: string | null;
  status: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CrmDashboard {
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
  insights: {
    available: boolean;
    periodDays: number;
    totals: {
      views: number;
      followersGained: number;
      interactions: number;
      engagementRate: number;
    };
    timeline: Array<{ label: string; views: number }>;
    topPosts: Array<{
      id: string;
      text: string;
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      permalink?: string;
    }>;
    themes: Array<{ label: string; averageViews: number; posts: number }>;
  };
}

@Injectable()
export class CrmService {
  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool
  ) {}

  async captureLead(input: {
    telegramId: string;
    displayName: string;
    username?: string;
    sourceCode?: string;
  }): Promise<LeadView> {
    const existing = await this.pool.query<LeadRow>(
      `UPDATE leads
       SET
         display_name = $2,
         username = $3,
         source_code = COALESCE($4, source_code),
         updated_at = NOW()
       WHERE id = (
         SELECT id FROM leads WHERE telegram_id = $1
         ORDER BY created_at DESC LIMIT 1
       )
       RETURNING id, telegram_id::text, display_name, username, source_code,
                 status, note, created_at, updated_at`,
      [input.telegramId, input.displayName, input.username ?? null, input.sourceCode ?? null]
    );
    const updated = existing.rows[0];
    if (updated) return this.mapLead(updated);

    const inserted = await this.pool.query<LeadRow>(
      `INSERT INTO leads (
         telegram_id, display_name, username, source_code, status
       ) VALUES ($1, $2, $3, $4, 'NEW')
       RETURNING id, telegram_id::text, display_name, username, source_code,
                 status, note, created_at, updated_at`,
      [input.telegramId, input.displayName, input.username ?? null, input.sourceCode ?? null]
    );
    const lead = inserted.rows[0];
    if (!lead) throw new Error("Не удалось сохранить заявку");
    return this.mapLead(lead);
  }

  async dashboard(userTelegramId: string): Promise<CrmDashboard> {
    const [drafts, publications] = await Promise.all([
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
      )
    ]);

    const draftCount = this.countMap(drafts.rows);
    const publicationCount = this.countMap(publications.rows);
    const threadsConfigured = Boolean(
      this.config.get<string>("THREADS_USER_ID", "") &&
      this.config.get<string>("THREADS_ACCESS_TOKEN", "")
    );
    const dryRun = this.config.get<string>("THREADS_DRY_RUN", "true") === "true";
    const apifyConfigured = Boolean(
      this.config.get<string>("APIFY_API_TOKEN", "") &&
      this.config.get<string>("APIFY_ACTOR_ID", "")
    );
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
          name: "Мониторинг рынка",
          state: apifyConfigured ? "working" : "setup",
          summary: apifyConfigured ? "Apify подключён" : "Apify ещё не подключён",
          detail: apifyConfigured
            ? "Ключ и Actor настроены на сервере."
            : "Система пока не собирает реальные обсуждения конкурентов, боли и возражения.",
          ...(!apifyConfigured ? { nextStep: "Добавить API token и Actor ID Apify." } : {})
        },
        {
          id: "threads",
          name: "Публикация Threads",
          state: threadsConfigured && !dryRun ? "working" : threadsConfigured ? "test" : "setup",
          summary: threadsConfigured
            ? dryRun ? "Подключено, но включён тест" : "Публикация включена"
            : "Threads API ещё не подключён",
          detail: dryRun
            ? "Одобрения сохраняются, но реальные посты не отправляются."
            : "Одобренные материалы публикуются через официальный API Threads.",
          ...(threadsConfigured
            ? dryRun ? { nextStep: "После контрольного поста выключить dry-run." } : {}
            : { nextStep: "Пройти OAuth Threads и сохранить токен на сервере." })
        },
        {
          id: "ai",
          name: "Нейросеть и голос",
          state: aiConfigured ? "test" : "setup",
          summary: aiConfigured ? "API подключён, голос калибруется" : "OpenAI API ещё не подключён",
          detail: aiConfigured
            ? "Генерацию можно тестировать, но для голоса эксперта всё ещё нужны примеры."
            : "Автоматическая генерация и оценка материалов пока не запускаются.",
          nextStep: aiConfigured
            ? "Добавить 15–20 постов эксперта и провести калибровку."
            : "Добавить API key и примеры текстов эксперта."
        }
      ],
      insights: {
        available: false,
        periodDays: 7,
        totals: {
          views: 0,
          followersGained: 0,
          interactions: 0,
          engagementRate: 0
        },
        timeline: [],
        topPosts: [],
        themes: []
      }
    };
  }

  async updateStatus(input: {
    actorTelegramId: string;
    leadId: string;
    status: LeadStatus;
  }): Promise<LeadView> {
    const result = await this.pool.query<LeadRow>(
      `WITH updated AS (
         UPDATE leads SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, telegram_id, display_name, username, source_code,
                   status, note, created_at, updated_at
       ), audit AS (
         INSERT INTO audit_log (
           actor_telegram_id, action, entity_type, entity_id, metadata
         )
         SELECT $3, 'LEAD_STATUS_CHANGED', 'lead', id::text,
                jsonb_build_object('status', status)
         FROM updated
       )
       SELECT id, telegram_id::text, display_name, username, source_code,
              status, note, created_at, updated_at
       FROM updated`,
      [input.leadId, input.status, input.actorTelegramId]
    );
    const lead = result.rows[0];
    if (!lead) throw new Error("Заявка не найдена");
    return this.mapLead(lead);
  }

  private countMap(rows: Array<{ status: string; count: string }>): Map<string, number> {
    return new Map(rows.map((row) => [row.status, Number(row.count)]));
  }

  private mapLead(row: LeadRow): LeadView {
    const status = LEAD_STATUSES.includes(row.status as LeadStatus)
      ? row.status as LeadStatus
      : "NEW";
    return {
      id: row.id,
      telegramId: row.telegram_id,
      displayName: row.display_name || row.username || `Telegram ${row.telegram_id}`,
      ...(row.username ? { username: row.username } : {}),
      ...(row.source_code ? { sourceCode: row.source_code } : {}),
      status,
      ...(row.note ? { note: row.note } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
