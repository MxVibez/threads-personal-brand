import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ExpertSettingsService } from "../src/miniapp/expert-settings.service";

describe("ExpertSettingsService", () => {
  it("creates safe defaults for a newly authorized user", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      timezone: "Asia/Krasnoyarsk",
      daily_publication_limit: 5,
      voice_profile: { description: "", avoid: "", examples: [] }
    }] });
    const service = new ExpertSettingsService({ query } as unknown as Pool);

    await expect(service.getOrCreate({
      telegramId: "1001",
      displayName: "Иван"
    })).resolves.toEqual({
      timezone: "Asia/Krasnoyarsk",
      dailyPublications: 5,
      voice: { description: "", avoid: "", examples: [] }
    });
  });

  it("saves schedule and voice without writing voice text to audit metadata", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      timezone: "Europe/Moscow",
      daily_publication_limit: 3,
      voice_profile: {
        description: "Говорит прямо",
        avoid: "Без гарантий",
        examples: ["Пример"]
      }
    }] });
    const service = new ExpertSettingsService({ query } as unknown as Pool);
    const settings = {
      timezone: "Europe/Moscow" as const,
      dailyPublications: 3,
      voice: {
        description: "Говорит прямо",
        avoid: "Без гарантий",
        examples: ["Пример"]
      }
    };

    await expect(service.save({
      telegramId: "1001",
      displayName: "Иван",
      settings
    })).resolves.toEqual(settings);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("EXPERT_SETTINGS_UPDATED");
    expect(sql).not.toContain("description");
    expect(sql).not.toContain("avoid");
  });
});

