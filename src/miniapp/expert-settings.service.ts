import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../infrastructure/database/database.tokens";

export const EXPERT_TIMEZONES = [
  "Europe/Moscow",
  "Asia/Krasnoyarsk"
] as const;

export type ExpertTimezone = (typeof EXPERT_TIMEZONES)[number];

export interface ExpertVoiceProfile {
  description: string;
  avoid: string;
  examples: string[];
}

export interface ExpertSettingsView {
  timezone: ExpertTimezone;
  dailyPublications: number;
  voice: ExpertVoiceProfile;
}

interface ExpertSettingsRow {
  timezone: string;
  daily_publication_limit: number;
  voice_profile: unknown;
}

const EMPTY_VOICE: ExpertVoiceProfile = {
  description: "",
  avoid: "",
  examples: []
};

@Injectable()
export class ExpertSettingsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getOrCreate(input: {
    telegramId: string;
    displayName: string;
  }): Promise<ExpertSettingsView> {
    const result = await this.pool.query<ExpertSettingsRow>(
      `INSERT INTO experts (telegram_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         updated_at = NOW()
       RETURNING timezone, daily_publication_limit, voice_profile`,
      [input.telegramId, input.displayName]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Не удалось загрузить настройки");
    return this.mapSettings(row);
  }

  async save(input: {
    telegramId: string;
    actorTelegramId?: string;
    displayName: string;
    settings: ExpertSettingsView;
  }): Promise<ExpertSettingsView> {
    const result = await this.pool.query<ExpertSettingsRow>(
      `WITH saved AS (
         INSERT INTO experts (
           telegram_id, display_name, timezone,
           daily_publication_limit, voice_profile
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (telegram_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           timezone = EXCLUDED.timezone,
           daily_publication_limit = EXCLUDED.daily_publication_limit,
           voice_profile = EXCLUDED.voice_profile,
           updated_at = NOW()
         RETURNING telegram_id, timezone, daily_publication_limit, voice_profile
       ), audit AS (
         INSERT INTO audit_log (
           actor_telegram_id, action, entity_type, entity_id, metadata
         )
         SELECT $6::bigint, 'EXPERT_SETTINGS_UPDATED', 'expert_settings',
                telegram_id::text,
                jsonb_build_object(
                  'timezone', timezone,
                  'dailyPublications', daily_publication_limit,
                  'voiceExamples', jsonb_array_length(voice_profile->'examples')
                )
         FROM saved
       )
       SELECT timezone, daily_publication_limit, voice_profile FROM saved`,
      [
        input.telegramId,
        input.displayName,
        input.settings.timezone,
        input.settings.dailyPublications,
        JSON.stringify(input.settings.voice),
        input.actorTelegramId ?? input.telegramId
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Не удалось сохранить настройки");
    return this.mapSettings(row);
  }

  private mapSettings(row: ExpertSettingsRow): ExpertSettingsView {
    const timezone = EXPERT_TIMEZONES.includes(row.timezone as ExpertTimezone)
      ? row.timezone as ExpertTimezone
      : "Asia/Krasnoyarsk";
    const voice = this.parseVoice(row.voice_profile);
    return {
      timezone,
      dailyPublications: Math.max(1, Math.min(10, Number(row.daily_publication_limit) || 5)),
      voice
    };
  }

  private parseVoice(value: unknown): ExpertVoiceProfile {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_VOICE };
    const profile = value as Record<string, unknown>;
    return {
      description: typeof profile.description === "string" ? profile.description : "",
      avoid: typeof profile.avoid === "string" ? profile.avoid : "",
      examples: Array.isArray(profile.examples)
        ? profile.examples.filter((item): item is string => typeof item === "string").slice(0, 20)
        : []
    };
  }
}
