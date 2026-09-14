import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { z } from "zod";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";

const PERIOD_DAYS = 30;
const POSTS_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 12_000;

const metricSchema = z.object({
  name: z.string(),
  values: z.array(z.object({
    value: z.number().nonnegative(),
    end_time: z.string().optional()
  })).optional(),
  total_value: z.object({ value: z.number().nonnegative() }).optional()
});

const insightsResponseSchema = z.object({ data: z.array(metricSchema) });
const postsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    text: z.string().max(10_000).optional().default(""),
    permalink: z.string().max(2_048).optional(),
    timestamp: z.string().max(64),
    is_reply: z.boolean().optional().default(false),
    is_quote_post: z.boolean().optional().default(false)
  })).max(POSTS_LIMIT)
});

export interface ThreadsAnalyticsDashboard {
  available: boolean;
  stale: boolean;
  incomplete: boolean;
  periodDays: number;
  updatedAt?: string;
  unavailableReason?: string;
  totals: {
    profileViews: number;
    followers: number;
    postViews: number;
    interactions: number;
    engagementRate: number;
  };
  timeline: Array<{ label: string; views: number }>;
  topPosts: Array<{
    id: string;
    text: string;
    hook: string;
    publishedAt: string;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    permalink?: string;
  }>;
  themes: Array<{ label: string; averageViews: number; posts: number }>;
  takeaway?: string;
}

interface CacheRow {
  payload: unknown;
  refreshed_at: Date;
}

interface ThreadsPost {
  id: string;
  text: string;
  permalink?: string;
  timestamp: string;
  is_reply: boolean;
  is_quote_post: boolean;
}

interface PostMetrics {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

@Injectable()
export class ThreadsAnalyticsService {
  private readonly logger = new Logger(ThreadsAnalyticsService.name);
  private refresh: Promise<ThreadsAnalyticsDashboard> | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool
  ) {}

  async dashboard(): Promise<ThreadsAnalyticsDashboard> {
    const accountId = this.config.get<string>("THREADS_USER_ID", "").trim();
    const token = this.config.get<string>("THREADS_ACCESS_TOKEN", "").trim();
    if (!accountId || !token) return emptyAnalytics("Threads API ещё не подключён");

    const cached = await this.loadCache(accountId);
    const ttlSeconds = this.config.get<number>("THREADS_ANALYTICS_CACHE_SECONDS", 900);
    if (cached && Date.now() - cached.refreshed_at.getTime() < ttlSeconds * 1_000) {
      return this.parseCached(cached);
    }

    try {
      this.refresh ??= this.fetchAndStore(accountId, token).finally(() => {
        this.refresh = null;
      });
      return await this.refresh;
    } catch (error) {
      this.logger.warn(`Threads analytics refresh failed: ${safeErrorMessage(error, token)}`);
      if (cached) return { ...this.parseCached(cached), stale: true };
      return emptyAnalytics(
        "Meta не отдала статистику. Проверьте разрешение threads_manage_insights."
      );
    }
  }

  private async loadCache(accountId: string): Promise<CacheRow | null> {
    const result = await this.pool.query<CacheRow>(
      `SELECT payload, refreshed_at
       FROM threads_analytics_cache
       WHERE account_id = $1`,
      [accountId]
    );
    return result.rows[0] ?? null;
  }

  private parseCached(row: CacheRow): ThreadsAnalyticsDashboard {
    const parsed = analyticsDashboardSchema.safeParse(row.payload);
    if (!parsed.success) return emptyAnalytics("Кэш аналитики повреждён");
    return {
      ...parsed.data,
      stale: false,
      updatedAt: row.refreshed_at.toISOString()
    };
  }

  private async fetchAndStore(
    accountId: string,
    token: string
  ): Promise<ThreadsAnalyticsDashboard> {
    const end = Math.floor(Date.now() / 1_000);
    const start = end - PERIOD_DAYS * 24 * 60 * 60;
    const [accountInsights, posts] = await Promise.all([
      this.getAccountInsights(token, start, end),
      this.getPosts(token, start)
    ]);
    const originalPosts = posts.filter((post) => !post.is_reply);
    const postResults = await mapWithConcurrency(originalPosts, 5, async (post) => {
      try {
        return { post, metrics: await this.getPostInsights(token, post.id) };
      } catch (error) {
        this.logger.warn(
          `Threads post insights failed for ${post.id}: ${safeErrorMessage(error, token)}`
        );
        return null;
      }
    });
    const postMetrics = postResults.filter(
      (item): item is { post: ThreadsPost; metrics: PostMetrics } => item !== null
    );

    const accountMetricMap = new Map(accountInsights.map((metric) => [metric.name, metric]));
    const timeline = (accountMetricMap.get("views")?.values ?? [])
      .filter((item): item is { value: number; end_time: string } => Boolean(item.end_time))
      .map((item) => ({ label: formatDay(item.end_time), views: item.value }));
    const topPosts = postMetrics
      .map(({ post, metrics }) => ({
        id: post.id,
        text: post.text || "Публикация без текста",
        hook: firstLine(post.text),
        publishedAt: post.timestamp,
        ...metrics,
        ...(safeThreadsUrl(post.permalink) ? { permalink: safeThreadsUrl(post.permalink) } : {})
      }))
      .sort((left, right) => right.views - left.views || right.likes - left.likes)
      .slice(0, 10);
    const postViews = postMetrics.reduce((sum, item) => sum + item.metrics.views, 0);
    const interactions = ["likes", "replies", "reposts", "quotes"]
      .reduce((sum, name) => sum + metricTotal(accountMetricMap.get(name)), 0);
    const themes = buildThemes(postMetrics);
    const best = topPosts[0];
    const bestTheme = themes[0];
    const payload: ThreadsAnalyticsDashboard = {
      available: true,
      stale: false,
      incomplete: postMetrics.length !== originalPosts.length,
      periodDays: PERIOD_DAYS,
      totals: {
        profileViews: timeline.reduce((sum, item) => sum + item.views, 0),
        followers: metricTotal(accountMetricMap.get("followers_count")),
        postViews,
        interactions,
        engagementRate: postViews > 0 ? round(interactions / postViews * 100, 1) : 0
      },
      timeline,
      topPosts,
      themes,
      ...(best
        ? {
            takeaway: bestTheme
              ? `Лучше всего заходит тема «${bestTheme.label}». Сильнейший заход: «${best.hook}».`
              : `Сильнейший заход за период: «${best.hook}».`
          }
        : {})
    };

    const refreshed = await this.pool.query<{ refreshed_at: Date }>(
      `INSERT INTO threads_analytics_cache (account_id, payload, refreshed_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (account_id) DO UPDATE
       SET payload = EXCLUDED.payload, refreshed_at = NOW()
       RETURNING refreshed_at`,
      [accountId, JSON.stringify(payload)]
    );
    return {
      ...payload,
      updatedAt: (refreshed.rows[0]?.refreshed_at ?? new Date()).toISOString()
    };
  }

  private async getAccountInsights(token: string, since: number, until: number) {
    const params = new URLSearchParams({
      metric: "views,likes,replies,reposts,quotes,followers_count",
      since: String(since),
      until: String(until)
    });
    const payload = await this.getJson(token, `/me/threads_insights?${params}`);
    return insightsResponseSchema.parse(payload).data;
  }

  private async getPosts(token: string, since: number): Promise<ThreadsPost[]> {
    const params = new URLSearchParams({
      fields: "id,text,permalink,timestamp,is_reply,is_quote_post",
      since: String(since),
      limit: String(POSTS_LIMIT)
    });
    const payload = await this.getJson(token, `/me/threads?${params}`);
    return postsResponseSchema.parse(payload).data;
  }

  private async getPostInsights(token: string, postId: string): Promise<PostMetrics> {
    const params = new URLSearchParams({ metric: "views,likes,replies,reposts,quotes" });
    const payload = await this.getJson(
      token,
      `/${encodeURIComponent(postId)}/insights?${params}`
    );
    const metrics = insightsResponseSchema.parse(payload).data;
    const metricMap = new Map(metrics.map((metric) => [metric.name, metric]));
    return {
      views: metricTotal(metricMap.get("views")),
      likes: metricTotal(metricMap.get("likes")),
      replies: metricTotal(metricMap.get("replies")),
      reposts: metricTotal(metricMap.get("reposts")),
      quotes: metricTotal(metricMap.get("quotes"))
    };
  }

  private async getJson(token: string, path: string): Promise<unknown> {
    const baseUrl = this.config.get<string>(
      "THREADS_API_BASE_URL",
      "https://graph.threads.net"
    ).replace(/\/$/, "");
    const version = this.config.get<string>("THREADS_API_VERSION", "v1.0");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${version}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new Error(`network: ${safeErrorMessage(error, token)}`);
    }
    const payload = await response.json().catch(() => null) as
      | { error?: { message?: unknown; code?: unknown } }
      | null;
    if (!response.ok) {
      const message = typeof payload?.error?.message === "string"
        ? payload.error.message.slice(0, 300)
        : `HTTP ${response.status}`;
      throw new Error(`Meta ${response.status}: ${message}`);
    }
    return payload;
  }
}

const analyticsDashboardSchema: z.ZodType<ThreadsAnalyticsDashboard> = z.object({
  available: z.boolean(),
  stale: z.boolean(),
  incomplete: z.boolean(),
  periodDays: z.number().int().positive(),
  updatedAt: z.string().optional(),
  unavailableReason: z.string().optional(),
  totals: z.object({
    profileViews: z.number().nonnegative(),
    followers: z.number().nonnegative(),
    postViews: z.number().nonnegative(),
    interactions: z.number().nonnegative(),
    engagementRate: z.number().nonnegative()
  }),
  timeline: z.array(z.object({ label: z.string(), views: z.number().nonnegative() })),
  topPosts: z.array(z.object({
    id: z.string(),
    text: z.string(),
    hook: z.string(),
    publishedAt: z.string(),
    views: z.number().nonnegative(),
    likes: z.number().nonnegative(),
    replies: z.number().nonnegative(),
    reposts: z.number().nonnegative(),
    quotes: z.number().nonnegative(),
    permalink: z.string().optional()
  })),
  themes: z.array(z.object({
    label: z.string(),
    averageViews: z.number().nonnegative(),
    posts: z.number().int().nonnegative()
  })),
  takeaway: z.string().optional()
});

export function emptyAnalytics(reason?: string): ThreadsAnalyticsDashboard {
  return {
    available: false,
    stale: false,
    incomplete: false,
    periodDays: PERIOD_DAYS,
    ...(reason ? { unavailableReason: reason } : {}),
    totals: {
      profileViews: 0,
      followers: 0,
      postViews: 0,
      interactions: 0,
      engagementRate: 0
    },
    timeline: [],
    topPosts: [],
    themes: []
  };
}

function metricTotal(metric: z.infer<typeof metricSchema> | undefined): number {
  if (!metric) return 0;
  if (metric.total_value) return metric.total_value.value;
  return metric.values?.reduce((sum, item) => sum + item.value, 0) ?? 0;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? "Публикация";
  return line.length > 110 ? `${line.slice(0, 107)}…` : line;
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Krasnoyarsk"
  }).format(date).replace(".", "");
}

function classifyTheme(text: string): string {
  const value = text.toLocaleLowerCase("ru-RU");
  if (/аватар|ai[- ]?блог|ии[- ]?блог|нейрон|контент/.test(value)) return "AI-контент";
  if (/telegram|телеграм|mini app|приложен|ios|android|сайт|web|веб/.test(value)) return "Приложения";
  if (/автомат|воронк|процесс|crm|бот/.test(value)) return "Автоматизация";
  if (/продаж|клиент|бизнес|заявк|эксперт/.test(value)) return "Продажи";
  return "Личный опыт";
}

function safeThreadsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === "threads.com" || host.endsWith(".threads.com") ||
      host === "threads.net" || host.endsWith(".threads.net");
    return url.protocol === "https:" && allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function buildThemes(
  items: Array<{ post: ThreadsPost; metrics: PostMetrics }>
): ThreadsAnalyticsDashboard["themes"] {
  const groups = new Map<string, { views: number; posts: number }>();
  for (const item of items) {
    const label = classifyTheme(item.post.text);
    const group = groups.get(label) ?? { views: 0, posts: 0 };
    group.views += item.metrics.views;
    group.posts += 1;
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([label, group]) => ({
      label,
      averageViews: Math.round(group.views / group.posts),
      posts: group.posts
    }))
    .sort((left, right) => right.averageViews - left.averageViews);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  ));
  return results;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeErrorMessage(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
  return secret ? message.split(secret).join("[REDACTED]") : message;
}
