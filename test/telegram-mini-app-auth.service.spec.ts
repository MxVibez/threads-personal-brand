import { createHmac } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { TelegramAccessService } from "../src/access/telegram-access.service";
import {
  TelegramMiniAppAuthService,
  validateTelegramInitData
} from "../src/miniapp/telegram-mini-app-auth.service";

const BOT_TOKEN = "test-only-bot-token-for-signature";
const NOW = 1_800_000_000;

function signedInitData(overrides: Record<string, string> = {}): string {
  const values = new Map<string, string>([
    ["auth_date", String(NOW)],
    ["query_id", "AAEAAAE"],
    [
      "user",
      JSON.stringify({
        id: 1001,
        first_name: "Иван",
        username: "expert"
      })
    ]
  ]);
  for (const [key, value] of Object.entries(overrides)) values.set(key, value);

  const dataCheckString = [...values.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const params = new URLSearchParams([...values.entries(), ["hash", hash]]);
  return params.toString();
}

describe("validateTelegramInitData", () => {
  it("accepts fresh init data signed with the bot token", () => {
    const identity = validateTelegramInitData({
      initData: signedInitData(),
      botToken: BOT_TOKEN,
      maxAgeSeconds: 3_600,
      nowSeconds: NOW
    });

    expect(identity).toMatchObject({
      telegramId: "1001",
      displayName: "Иван",
      username: "expert",
      queryId: "AAEAAAE"
    });
  });

  it("rejects init data after any signed field is changed", () => {
    const params = new URLSearchParams(signedInitData());
    params.set("query_id", "CHANGED");
    const tampered = params.toString();
    expect(() =>
      validateTelegramInitData({
        initData: tampered,
        botToken: BOT_TOKEN,
        maxAgeSeconds: 3_600,
        nowSeconds: NOW
      })
    ).toThrow();
  });

  it("rejects an expired Telegram session", () => {
    expect(() =>
      validateTelegramInitData({
        initData: signedInitData({ auth_date: String(NOW - 3_601) }),
        botToken: BOT_TOKEN,
        maxAgeSeconds: 3_600,
        nowSeconds: NOW
      })
    ).toThrow("expired");
  });

  it("rejects a Telegram session dated in the future", () => {
    expect(() =>
      validateTelegramInitData({
        initData: signedInitData({ auth_date: String(NOW + 31) }),
        botToken: BOT_TOKEN,
        maxAgeSeconds: 3_600,
        nowSeconds: NOW
      })
    ).toThrow("future");
  });

  it("rejects duplicate fields even when the signature field is present", () => {
    const initData = `${signedInitData()}&auth_date=${NOW}`;
    expect(() =>
      validateTelegramInitData({
        initData,
        botToken: BOT_TOKEN,
        maxAgeSeconds: 3_600,
        nowSeconds: NOW
      })
    ).toThrow("duplicates");
  });
});

describe("TelegramMiniAppAuthService", () => {
  function createService(allowed: boolean, isOwner = false) {
    const config = {
      get(key: string, fallback: unknown) {
        if (key === "TELEGRAM_BOT_TOKEN") return BOT_TOKEN;
        if (key === "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS") return 3_600;
        return fallback;
      }
    } as ConfigService;
    const access = {
      canUseMiniApp: vi.fn().mockResolvedValue(allowed),
      isOwner: vi.fn().mockReturnValue(isOwner)
    } as unknown as TelegramAccessService;
    return {
      service: new TelegramMiniAppAuthService(config, access),
      access
    };
  }

  it("allows a signed Telegram user after the owner granted access", async () => {
    const { service } = createService(true);
    const fresh = signedInitData({
      auth_date: String(Math.floor(Date.now() / 1_000))
    });

    await expect(service.authenticate(`tma ${fresh}`)).resolves.toMatchObject({
      telegramId: "1001",
      username: "expert",
      isOwner: false
    });
  });

  it("denies a valid Telegram user while access is pending", async () => {
    const { service } = createService(false);
    const fresh = signedInitData({
      auth_date: String(Math.floor(Date.now() / 1_000))
    });

    await expect(service.authenticate(`tma ${fresh}`)).rejects.toThrow(
      "Доступ к приложению ещё не выдан"
    );
  });
});
