import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";

const SEARCH_TERMS = [
  "[TOPIC_PRIMARY]",
  "[TOPIC_AUDIENCE_QUESTION]",
  "[TOPIC_PAIN_POINT]",
  "[TOPIC_OBJECTION]"
];

const APIFY_REQUEST_TIMEOUT_MS = 20_000;
const MAX_MARKET_TEXT_LENGTH = 10_000;
const MAX_RAW_ITEM_LENGTH = 100_000;

type ApifyRun = {
  id: string;
  status: string;
  defaultDatasetId?: string;
};

type MarketItem = Record<string, unknown>;

@Injectable()
export class MarketMonitorService implements OnModuleInit, OnApplicationShutdown {
  private startupTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>("APIFY_MARKET_ENABLED", "false") !== "true") return;
    this.startupTimer = setTimeout(() => void this.runIfDue(), 8_000);
    this.interval = setInterval(() => void this.runIfDue(), 60 * 60 * 1_000);
  }

  onApplicationShutdown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.interval) clearInterval(this.interval);
  }

  async runIfDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let runRecordId: string | null = null;
    try {
      const token = this.config.get<string>("APIFY_API_TOKEN", "");
      const actor = this.config.get<string>("APIFY_ACTOR_ID", "");
      if (!token || !actor) return;

      const testRuns = await this.pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM market_monitor_runs"
      );
      const runLimit = this.config.get<number>("APIFY_TEST_RUN_LIMIT", 9);
      if (Number(testRuns.rows[0]?.count ?? "0") >= runLimit) return;

      const reserved = await this.pool.query<{ id: string }>(
        `INSERT INTO market_monitor_runs (run_date, status)
         VALUES ((NOW() AT TIME ZONE 'Asia/Krasnoyarsk')::date, 'STARTING')
         ON CONFLICT (run_date) DO NOTHING
         RETURNING id`
      );
      runRecordId = reserved.rows[0]?.id ?? null;
      if (!runRecordId) return;

      const maxResults = this.config.get<number>("APIFY_DAILY_MAX_RESULTS", 100);
      const maxCharge = this.config.get<number>("APIFY_MAX_CHARGE_USD", 0.5);
      const run = await this.startActor(token, actor, maxResults, maxCharge);
      await this.pool.query(
        `UPDATE market_monitor_runs
         SET apify_run_id = $2, dataset_id = $3, status = 'RUNNING'
         WHERE id = $1`,
        [runRecordId, run.id, run.defaultDatasetId ?? null]
      );
      const finished = await this.waitForRun(token, run);
      if (finished.status !== "SUCCEEDED" || !finished.defaultDatasetId) {
        throw new Error(`Apify run finished with status ${finished.status}`);
      }
      const items = await this.loadDataset(token, finished.defaultDatasetId, maxResults);
      await this.storeItems(items);
      await this.pool.query(
        `UPDATE market_monitor_runs
         SET status = 'SUCCEEDED', dataset_id = $2, item_count = $3,
             finished_at = NOW(), error = NULL
         WHERE id = $1`,
        [runRecordId, finished.defaultDatasetId, items.length]
      );
    } catch (error) {
      if (runRecordId) {
        const message = error instanceof Error ? error.message : "Unknown market monitor error";
        await this.pool.query(
          `UPDATE market_monitor_runs
           SET status = 'FAILED', error = $2, finished_at = NOW()
           WHERE id = $1`,
          [runRecordId, message.slice(0, 1_000)]
        ).catch(() => undefined);
      }
    } finally {
      this.running = false;
    }
  }

  private async startActor(
    token: string,
    actor: string,
    maxResults: number,
    maxCharge: number
  ): Promise<ApifyRun> {
    const actorId = actor.replace("/", "~");
    const query = new URLSearchParams({
      maxItems: String(maxResults),
      maxTotalChargeUsd: String(maxCharge)
    });
    const response = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?${query}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ urls: SEARCH_TERMS, mode: "search", maxResults }),
        signal: AbortSignal.timeout(APIFY_REQUEST_TIMEOUT_MS)
      }
    );
    if (!response.ok) throw new Error(`Apify start failed: HTTP ${response.status}`);
    const payload = await response.json() as { data: ApifyRun };
    if (!payload.data || typeof payload.data.id !== "string") {
      throw new Error("Apify start returned an invalid payload");
    }
    return payload.data;
  }

  private async waitForRun(token: string, initial: ApifyRun): Promise<ApifyRun> {
    let run = initial;
    const finishedStates = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
    for (let attempt = 0; attempt < 72 && !finishedStates.has(run.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const response = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(APIFY_REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`Apify status failed: HTTP ${response.status}`);
      const payload = await response.json() as { data: ApifyRun };
      if (!payload.data || typeof payload.data.id !== "string" || typeof payload.data.status !== "string") {
        throw new Error("Apify status returned an invalid payload");
      }
      run = payload.data;
    }
    return run;
  }

  private async loadDataset(token: string, datasetId: string, limit: number): Promise<MarketItem[]> {
    const response = await fetch(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=${limit}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(APIFY_REQUEST_TIMEOUT_MS)
      }
    );
    if (!response.ok) throw new Error(`Apify dataset failed: HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Apify dataset returned an invalid payload");
    return payload.filter((item): item is MarketItem => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, limit);
  }

  private async storeItems(items: MarketItem[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of items) await this.storeItem(client, item);
      await client.query(
        `INSERT INTO market_accounts (
           username, post_count, question_count, total_engagement,
           peak_engagement, score, last_post_at, updated_at
         )
         SELECT
           username,
           COUNT(*)::int,
           COUNT(*) FILTER (WHERE text LIKE '%?%')::int,
           SUM(like_count + reply_count * 2 + repost_count * 3 + quote_count * 3),
           MAX(like_count + reply_count * 2 + repost_count * 3 + quote_count * 3),
           ROUND((
             AVG(like_count + reply_count * 2 + repost_count * 3 + quote_count * 3)
             + COUNT(*) FILTER (WHERE text LIKE '%?%') * 5
           )::numeric, 2),
           MAX(posted_at),
           NOW()
         FROM market_posts
         GROUP BY username
         ON CONFLICT (username) DO UPDATE SET
           post_count = EXCLUDED.post_count,
           question_count = EXCLUDED.question_count,
           total_engagement = EXCLUDED.total_engagement,
           peak_engagement = EXCLUDED.peak_engagement,
           score = EXCLUDED.score,
           last_post_at = EXCLUDED.last_post_at,
           updated_at = NOW()`
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async storeItem(client: PoolClient, item: MarketItem): Promise<void> {
    const text = this.string(item.text ?? item.caption ?? item.content).slice(0, MAX_MARKET_TEXT_LENGTH);
    const username = this.string(item.username ?? (item.author as Record<string, unknown> | undefined)?.username).slice(0, 120);
    const postUrl = this.threadsUrl(item.postUrl ?? item.post_url ?? item.url);
    if (!text || !username || !postUrl) return;
    await client.query(
      `INSERT INTO market_posts (
         post_code, post_url, username, query, text,
         like_count, reply_count, repost_count, quote_count,
         share_count, view_count, is_reply, posted_at, scraped_at, raw
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
       )
       ON CONFLICT (post_url) DO UPDATE SET
         like_count = EXCLUDED.like_count,
         reply_count = EXCLUDED.reply_count,
         repost_count = EXCLUDED.repost_count,
         quote_count = EXCLUDED.quote_count,
         share_count = EXCLUDED.share_count,
         view_count = EXCLUDED.view_count,
         scraped_at = EXCLUDED.scraped_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        this.string(item.postCode ?? item.post_code).slice(0, 160) || null,
        postUrl,
        username,
        this.string(item.query).slice(0, 240) || null,
        text,
        this.number(item.likeCount ?? item.like_count ?? item.likes),
        this.number(item.replyCount ?? item.reply_count ?? item.replies),
        this.number(item.repostCount ?? item.repost_count ?? item.reposts),
        this.number(item.quoteCount ?? item.quote_count ?? item.quotes),
        this.number(item.shareCount ?? item.share_count ?? item.shares),
        this.number(item.viewCount ?? item.view_count ?? item.views),
        item.isReply === true || item.is_reply === true,
        this.date(item.postedAt ?? item.posted_at),
        this.date(item.scrapedAt ?? item.scraped_at),
        this.safeRawItem(item)
      ]
    );
  }

  private string(value: unknown): string {
    return typeof value === "string" ? value.replaceAll("\u0000", "").trim() : "";
  }

  private threadsUrl(value: unknown): string {
    const raw = this.string(value).slice(0, 2_048);
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const isThreadsHost =
        host === "threads.com" ||
        host.endsWith(".threads.com") ||
        host === "threads.net" ||
        host.endsWith(".threads.net");
      return url.protocol === "https:" && isThreadsHost ? url.toString() : "";
    } catch {
      return "";
    }
  }

  private safeRawItem(item: MarketItem): string {
    const serialized = JSON.stringify(item, (_key, value) => typeof value === "string" ? value.replaceAll("\u0000", "") : value);
    if (serialized.length <= MAX_RAW_ITEM_LENGTH) return serialized;
    return JSON.stringify({
      truncated: true,
      keys: Object.keys(item).slice(0, 100)
    });
  }

  private number(value: unknown): number {
    const parsed = Number(value);
    // Engagement expressions use PostgreSQL int4 (including weights up to 3).
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(200_000_000, Math.round(parsed)) : 0;
  }

  private date(value: unknown): Date | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
