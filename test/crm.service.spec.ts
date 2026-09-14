import type { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ThreadsResultsService } from "../src/results/threads-results.service";
import { emptyAnalytics, type ThreadsAnalyticsService } from "../src/results/threads-analytics.service";

function analyticsStub(): ThreadsAnalyticsService {
  return {
    dashboard: vi.fn().mockResolvedValue(emptyAnalytics())
  } as unknown as ThreadsAnalyticsService;
}

describe("ThreadsResultsService", () => {
  it("returns real counters and reports unconfigured providers", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { status: "WAITING_APPROVAL", count: "2" },
        { status: "APPROVED", count: "3" }
      ] })
      .mockResolvedValueOnce({ rows: [
        { status: "PUBLISHED", count: "1" },
        { status: "FAILED", count: "1" }
      ] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;
    const config = {
      get(key: string, fallback: unknown) {
        if (key === "THREADS_DRY_RUN") return "true";
        return fallback;
      }
    } as unknown as ConfigService;
    const service = new ThreadsResultsService(config, pool, analyticsStub());

    const result = await service.dashboard("1001");

    expect(result.counts).toMatchObject({
      waiting: 2,
      approved: 3,
      published: 1,
      failed: 1
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(result.integrations.find((item) => item.id === "telegram")?.state).toBe("working");
    expect(result.integrations.find((item) => item.id === "apify")?.state).toBe("setup");
    expect(result.integrations.find((item) => item.id === "threads")?.state).toBe("setup");
    expect(result.insights.available).toBe(false);
  });

  it("reports an API-only Apify connection without claiming that collection is running", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;
    const config = {
      get(key: string, fallback: unknown) {
        if (key === "APIFY_API_TOKEN") return "apify_api_test";
        if (key === "THREADS_DRY_RUN") return "true";
        return fallback;
      }
    } as unknown as ConfigService;
    const service = new ThreadsResultsService(config, pool, analyticsStub());

    const result = await service.dashboard("1001");
    const apify = result.integrations.find((item) => item.id === "apify");

    expect(apify?.state).toBe("test");
    expect(apify?.summary).toBe("Apify API подключён");
    expect(apify?.detail).toContain("Actor, расписание и сбор данных подключим позже");
  });
});
