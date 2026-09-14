import type { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadsAnalyticsService } from "../src/results/threads-analytics.service";

function config(): ConfigService {
  return {
    get(key: string, fallback: unknown) {
      if (key === "THREADS_USER_ID") return "account-1";
      if (key === "THREADS_ACCESS_TOKEN") return "server-only-token";
      if (key === "THREADS_API_BASE_URL") return "https://graph.threads.net";
      if (key === "THREADS_API_VERSION") return "v1.0";
      if (key === "THREADS_ANALYTICS_CACHE_SECONDS") return 900;
      return fallback;
    }
  } as unknown as ConfigService;
}

afterEach(() => vi.unstubAllGlobals());

describe("ThreadsAnalyticsService", () => {
  it("loads real account and post metrics and stores a server-side cache", async () => {
    const refreshedAt = new Date("2026-09-14T12:00:00.000Z");
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ refreshed_at: refreshedAt }] });
    const pool = { query } as unknown as Pool;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("threads_insights")) {
        return response({ data: [
          { name: "views", values: [{ value: 12, end_time: "2026-09-14T07:00:00+0000" }] },
          { name: "likes", total_value: { value: 4 } },
          { name: "replies", total_value: { value: 2 } },
          { name: "reposts", total_value: { value: 1 } },
          { name: "quotes", total_value: { value: 0 } },
          { name: "followers_count", total_value: { value: 25 } }
        ] });
      }
      if (url.includes("/me/threads?")) {
        return response({ data: [{
          id: "post-1",
          text: "Как приложение возвращает клиентов\nРазбираю механику.",
          permalink: "javascript:alert(1)",
          timestamp: "2026-09-14T06:00:00+0000",
          is_reply: false,
          is_quote_post: false
        }] });
      }
      return response({ data: [
        { name: "views", values: [{ value: 100 }] },
        { name: "likes", values: [{ value: 4 }] },
        { name: "replies", values: [{ value: 2 }] },
        { name: "reposts", values: [{ value: 1 }] },
        { name: "quotes", values: [{ value: 0 }] }
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ThreadsAnalyticsService(config(), pool).dashboard();

    expect(result.available).toBe(true);
    expect(result.totals).toMatchObject({
      profileViews: 12,
      followers: 25,
      postViews: 100,
      interactions: 7,
      engagementRate: 7
    });
    expect(result.topPosts[0]).toMatchObject({
      id: "post-1",
      hook: "Как приложение возвращает клиентов",
      views: 100
    });
    expect(result.topPosts[0]?.permalink).toBeUndefined();
    expect(result.themes[0]?.label).toBe("Приложения");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO threads_analytics_cache"),
      expect.arrayContaining(["account-1", expect.any(String)])
    );
  });

  it("returns a fresh cache without calling Meta", async () => {
    const payload = {
      available: true,
      stale: false,
      incomplete: false,
      periodDays: 30,
      totals: { profileViews: 5, followers: 10, postViews: 20, interactions: 2, engagementRate: 10 },
      timeline: [],
      topPosts: [],
      themes: []
    };
    const pool = { query: vi.fn().mockResolvedValue({
      rows: [{ payload, refreshed_at: new Date() }]
    }) } as unknown as Pool;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ThreadsAnalyticsService(config(), pool).dashboard();

    expect(result.available).toBe(true);
    expect(result.totals.followers).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or credentials when analytics is unavailable", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("server-only-token")));

    const result = await new ThreadsAnalyticsService(config(), pool).dashboard();

    expect(result.available).toBe(false);
    expect(result.unavailableReason).not.toContain("server-only-token");
  });
});

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as Response;
}
