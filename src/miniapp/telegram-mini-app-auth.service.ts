import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TelegramAccessService } from "../access/telegram-access.service";

interface TelegramUserPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface MiniAppIdentity {
  telegramId: string;
  displayName: string;
  isOwner?: boolean;
  username?: string;
  languageCode?: string;
  queryId?: string;
}

interface ValidateInitDataInput {
  initData: string;
  botToken: string;
  maxAgeSeconds: number;
  nowSeconds?: number;
}

function parseTelegramUser(value: string | null): TelegramUserPayload {
  if (!value) throw new Error("Telegram user is missing");
  const parsed = JSON.parse(value) as Partial<TelegramUserPayload>;
  if (!Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0) {
    throw new Error("Telegram user id is invalid");
  }
  return parsed as TelegramUserPayload;
}

export function validateTelegramInitData(
  input: ValidateInitDataInput
): MiniAppIdentity {
  if (!input.initData || input.initData.length > 8_192) {
    throw new Error("Telegram init data is missing or too large");
  }

  const params = new URLSearchParams(input.initData);
  const keys = new Set<string>();
  for (const [key] of params) {
    if (keys.has(key)) throw new Error("Telegram init data contains duplicates");
    keys.add(key);
  }

  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error("Telegram hash is invalid");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(input.botToken)
    .digest();
  const calculatedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHashBuffer = Buffer.from(receivedHash, "hex");

  if (
    receivedHashBuffer.length !== calculatedHash.length ||
    !timingSafeEqual(receivedHashBuffer, calculatedHash)
  ) {
    throw new Error("Telegram signature does not match");
  }

  const authDate = Number(params.get("auth_date"));
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate)) {
    throw new Error("Telegram auth date is invalid");
  }
  if (authDate > nowSeconds + 30) {
    throw new Error("Telegram auth date is in the future");
  }
  if (nowSeconds - authDate > input.maxAgeSeconds) {
    throw new Error("Telegram init data has expired");
  }

  const user = parseTelegramUser(params.get("user"));
  return {
    telegramId: String(user.id),
    displayName:
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      user.username ||
      "Эксперт",
    ...(user.username ? { username: user.username } : {}),
    ...(user.language_code ? { languageCode: user.language_code } : {}),
    ...(params.get("query_id") ? { queryId: params.get("query_id")! } : {})
  };
}

@Injectable()
export class TelegramMiniAppAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly access: TelegramAccessService
  ) {}

  async authenticate(authorization: string | undefined): Promise<MiniAppIdentity> {
    const botToken = this.config.get<string>("TELEGRAM_BOT_TOKEN", "");
    if (!botToken) {
      throw new ServiceUnavailableException("Telegram integration is disabled");
    }

    const match = authorization?.match(/^tma\s+(.+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException("Open this Mini App from Telegram");
    }

    let identity: MiniAppIdentity;
    try {
      identity = validateTelegramInitData({
        initData: match[1],
        botToken,
        maxAgeSeconds: this.config.get<number>(
          "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS",
          3_600
        )
      });
    } catch {
      throw new UnauthorizedException("Telegram authorization is invalid or expired");
    }

    if (!(await this.access.canUseMiniApp(identity.telegramId))) {
      throw new UnauthorizedException("Доступ к приложению ещё не выдан");
    }
    return { ...identity, isOwner: this.access.isOwner(identity.telegramId) };
  }
}
