import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    APP_BASE_URL: z.string().url().optional(),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
    EXPERT_TELEGRAM_IDS: z.string().default(""),
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3_600),
    THREADS_API_BASE_URL: z.string().url().default("https://graph.threads.net"),
    THREADS_API_VERSION: z.string().default("v1.0"),
    META_THREADS_APP_ID: z.string().default(""),
    META_THREADS_APP_SECRET: z.string().default(""),
    THREADS_USER_ID: z.string().default(""),
    THREADS_ACCESS_TOKEN: z.string().default(""),
    THREADS_DRY_RUN: z.enum(["true", "false"]).default("true"),
    THREADS_MARKET_ENABLED: z.enum(["true", "false"]).default("false"),
    THREADS_MARKET_SEARCH_LIMIT: z.coerce.number().int().min(1).max(25).default(10),
    OPENAI_API_KEY: z.string().default(""),
    OPENAI_CLASSIFIER_MODEL: z.string().default("gpt-5.6-luna"),
    OPENAI_WRITER_MODEL: z.string().default("gpt-5.6-terra"),
    APIFY_API_TOKEN: z.string().default(""),
    APIFY_ACTOR_ID: z.string().default(""),
    APIFY_WEBHOOK_SECRET: z.string().default(""),
    APIFY_MARKET_ENABLED: z.enum(["true", "false"]).default("false"),
    APIFY_DAILY_MAX_RESULTS: z.coerce.number().int().min(10).max(500).default(100),
    APIFY_TEST_RUN_LIMIT: z.coerce.number().int().min(1).max(100).default(9),
    APIFY_MAX_CHARGE_USD: z.coerce.number().min(0.1).max(5).default(0.5),
    APP_ENCRYPTION_KEY: z.string().default("")
  })
  .superRefine((env, context) => {
    if (env.THREADS_DRY_RUN === "false" && (!env.THREADS_USER_ID.trim() || !env.THREADS_ACCESS_TOKEN.trim())) {
      context.addIssue({ code: "custom", path: ["THREADS_DRY_RUN"], message: "live publishing requires Threads user id and access token" });
    }
    if (env.TELEGRAM_BOT_TOKEN && parseExpertTelegramIds(env.EXPERT_TELEGRAM_IDS).size === 0) {
      context.addIssue({ code: "custom", path: ["EXPERT_TELEGRAM_IDS"], message: "at least one owner is required when Telegram is enabled" });
    }
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET.length < 16) {
      context.addIssue({
        code: "custom",
        path: ["TELEGRAM_WEBHOOK_SECRET"],
        message: "must contain at least 16 characters when Telegram is enabled"
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(input: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(input);
  if (result.success) return result.data;

  const message = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

export function parseExpertTelegramIds(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id))
  );
}
