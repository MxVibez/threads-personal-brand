import type { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { TelegramAccessService } from "../src/access/telegram-access.service";

function accessService(dryRun: boolean): TelegramAccessService {
  const config = {
    get(key: string, fallback: unknown) {
      if (key === "EXPERT_TELEGRAM_IDS") return "1001";
      if (key === "THREADS_DRY_RUN") return dryRun ? "true" : "false";
      return fallback;
    }
  } as ConfigService;
  return new TelegramAccessService(config, {} as Pool);
}

describe("TelegramAccessService workspace mutation policy", () => {
  it("allows testers to exercise shared actions while the app is in dry-run", () => {
    expect(accessService(true).canMutateWorkspace("2002")).toBe(true);
  });

  it("blocks testers from changing the shared Threads account in live mode", () => {
    expect(accessService(false).canMutateWorkspace("2002")).toBe(false);
  });

  it("keeps live workspace actions available to the owner", () => {
    expect(accessService(false).canMutateWorkspace("1001")).toBe(true);
  });
});
