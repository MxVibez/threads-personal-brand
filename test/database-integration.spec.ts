import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDraftRepository } from "../src/infrastructure/database/postgres-draft.repository";
import { PostgresPublicationRepository } from "../src/infrastructure/database/postgres-publication.repository";
import { ExpertSettingsService } from "../src/miniapp/expert-settings.service";

const db = new PGlite();
const adapter = {
  query: async (sql: string, values?: unknown[]) => {
    const result = await db.query(sql, values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
  connect: async () => ({ ...adapter, release() {} })
};
const pool = adapter as unknown as Pool;
const drafts = new PostgresDraftRepository(pool);
const publications = new PostgresPublicationRepository(pool);
beforeAll(async () => {
  const directory = join(process.cwd(), "src/infrastructure/database/migrations");
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    // PGlite has core gen_random_uuid(); the unused pgcrypto extension is not bundled.
    const sql = (await readFile(join(directory, name), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
    await db.exec(sql);
  }
}, 30_000);
afterAll(() => db.close());

describe("PostgreSQL migrations and repositories", () => {
  it("loads complete ordered threads with workspace isolation in one query", async () => {
    const first = await drafts.createDemo("9001");
    await drafts.createDemo("9002");
    const loaded = await drafts.listWaitingByExpert("9001");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(first);
    expect(loaded[0]?.segments).toHaveLength(3);
  });

  it("does not claim a future job and never republishes a cancelled job", async () => {
    const draft = await drafts.createDemo("9003");
    const approval = await drafts.approve({ draftId: draft.id, expertTelegramId: "9003", expectedVersion: 1, scheduledAt: new Date(Date.now() + 3_600_000) });
    expect(await publications.claimJob(approval.publicationJob.id)).toBeNull();
    await expect(drafts.cancelPlannedPublication({ publicationJobId: approval.publicationJob.id, expertTelegramId: "9002" })).rejects.toThrow("нет доступа");
    await drafts.cancelPlannedPublication({ publicationJobId: approval.publicationJob.id, expertTelegramId: "9003" });
    expect(await publications.claimJob(approval.publicationJob.id)).toBeNull();
    await expect(drafts.approve({ draftId: draft.id, expertTelegramId: "9003", expectedVersion: 1 })).rejects.toThrow("CANCELLED");
    expect(await drafts.listPlannedByExpert("9003")).toEqual([]);
  });

  it("persists the in-flight marker and keeps ambiguous results visible in the plan", async () => {
    const draft = await drafts.createDemo("9004");
    const approval = await drafts.approve({ draftId: draft.id, expertTelegramId: "9004", expectedVersion: 1, scheduledAt: new Date(Date.now() - 1_000) });
    const repeated = await drafts.approve({ draftId: draft.id, expertTelegramId: "9004", expectedVersion: 1 });
    expect(repeated.publicationJob.id).toBe(approval.publicationJob.id);
    const job = await publications.claimJob(approval.publicationJob.id);
    const segment = job!.segments[0]!;
    await publications.saveContainer(segment.id, "container-test");
    await publications.markSegmentPublishing(segment.id);
    const state = await db.query<{ status: string }>("SELECT status FROM publication_segments WHERE id = $1", [segment.id]);
    expect(state.rows[0]?.status).toBe("PUBLISHING");
    await publications.markSegmentNeedsReview(segment.id, "Ambiguous result");
    expect((await drafts.listPlannedByExpert("9004"))[0]?.status).toBe("NEEDS_REVIEW");
    expect(await publications.claimJob(job!.id)).toBeNull();
  });

  it("records the actual editor in the shared settings audit", async () => {
    const settings = { timezone: "Europe/Moscow" as const, dailyPublications: 7, voice: { description: "test", avoid: "", examples: ["sample"] } };
    await new ExpertSettingsService(pool).save({ telegramId: "9001", actorTelegramId: "9002", displayName: "Shared", settings });
    const audit = await db.query<{ actor: string }>("SELECT actor_telegram_id::text AS actor FROM audit_log WHERE action = 'EXPERT_SETTINGS_UPDATED'");
    expect(audit.rows[0]?.actor).toBe("9002");
    expect(await new ExpertSettingsService(pool).getOrCreate({ telegramId: "9001", displayName: "Shared" })).toEqual(settings);
  });
});
