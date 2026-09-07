import { z } from "zod";

/**
 * Central environment schema.
 *
 * Design decision: every process (api, admin, web, workers) imports `env`
 * from this package instead of reading `process.env` directly. That gives
 * us one validated, typed source of truth and fails fast on boot instead
 * of surfacing confusing runtime errors deep in a request handler.
 *
 * Marketplace/social credentials are intentionally OPTIONAL: the platform
 * must be able to boot and run entirely on mock providers/publishers in
 * development and CI. Each integration checks `isConfigured()` helpers
 * below instead of assuming the variable exists.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Core infrastructure
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // Services
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default("http://localhost:4000"),
  ADMIN_URL: z.string().url().default("http://localhost:3001"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),

  // Internal service-to-service auth (n8n -> api, admin -> api)
  INTERNAL_API_TOKEN: z.string().min(16, "INTERNAL_API_TOKEN must be at least 16 characters"),

  // Admin session auth
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(6).default("change-me-please"),

  // Marketplace affiliate credentials (optional -> mock providers used when absent)
  AMAZON_AFFILIATE_TAG: z.string().optional(),
  SHOPEE_AFFILIATE_ID: z.string().optional(),
  MERCADO_LIVRE_AFFILIATE_ID: z.string().optional(),

  // Amazon Creators API -- OAuth2 client credentials, replaces the retired
  // PA-API 5.0 (optional -> mock provider used when absent)
  AMAZON_CREATORS_CLIENT_ID: z.string().optional(),
  AMAZON_CREATORS_CLIENT_SECRET: z.string().optional(),

  // Shopee Affiliate Open API (optional -> mock provider used when absent)
  SHOPEE_APP_ID: z.string().optional(),
  SHOPEE_APP_SECRET: z.string().optional(),

  // Mercado Livre API -- OAuth2 app credentials + a refresh token obtained
  // once via a manual authorization-code exchange (optional -> mock
  // provider used when absent; see docs/providers.md)
  MERCADO_LIVRE_APP_ID: z.string().optional(),
  MERCADO_LIVRE_CLIENT_SECRET: z.string().optional(),
  MERCADO_LIVRE_REFRESH_TOKEN: z.string().optional(),

  // Telegram publisher (optional -> mock publisher used when absent)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // X/Twitter publisher (optional -> mock publisher used when absent)
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),

  // AI content generation via OpenRouter (optional -> deterministic
  // templates used when absent, or when the daily quota below is spent).
  // OPENROUTER_MODEL has no hardcoded default anywhere in this codebase --
  // OpenRouter's free-model catalog rotates over time, so pick a current
  // one from https://openrouter.ai/models?max_price=0 (models ending in
  // ":free"). Both must be set for the real generator to activate.
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  /** Caps AI-generated posts per UTC day, comfortably under OpenRouter's free-tier request cap. */
  AI_CONTENT_DAILY_LIMIT: z.coerce.number().int().positive().default(10),

  // Self-scheduled ingestion + publish routine (see apps/api/src/lib/scheduler.ts).
  // Off by default so dev/test/CI never spontaneously post to real
  // Telegram/X channels or spend OpenRouter quota just by booting the app.
  SCHEDULE_ENABLED: z.coerce.boolean().default(false),
  /** Comma-separated 24h UTC "HH:mm" times, e.g. "09:00,13:00,17:00,21:00". */
  SCHEDULE_TIMES: z
    .string()
    .regex(
      /^\d{2}:\d{2}(,\d{2}:\d{2})*$/,
      'SCHEDULE_TIMES must look like "09:00,13:00,17:00,21:00"',
    )
    .default("09:00,13:00,17:00,21:00"),
  /** Comma-separated marketplace codes to ingest each scheduled cycle. */
  SCHEDULE_MARKETPLACES: z.string().default("shopee_br,mercado_livre,amazon_br"),
  /** Gap between an ingestion trigger and the publish-ready-deals trigger, so evaluation has time to finish. */
  SCHEDULE_PUBLISH_DELAY_MINUTES: z.coerce.number().int().min(0).default(15),
  /** Max deals published per scheduled run, so one cycle can't flood every channel at once. */
  SCHEDULE_PUBLISH_LIMIT: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Parses and validates `process.env`. Throws with a readable message that
 * lists every failing field if validation fails, so a missing/incorrect
 * env var is caught at process start rather than at first use.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Escape hatch for tests that need to reset the memoized env. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

export const integrationStatus = {
  amazonAffiliate: (env: Env) => Boolean(env.AMAZON_AFFILIATE_TAG),
  shopeeAffiliate: (env: Env) => Boolean(env.SHOPEE_AFFILIATE_ID),
  amazonCreators: (env: Env) =>
    Boolean(env.AMAZON_CREATORS_CLIENT_ID && env.AMAZON_CREATORS_CLIENT_SECRET),
  shopeeOpenApi: (env: Env) => Boolean(env.SHOPEE_APP_ID && env.SHOPEE_APP_SECRET),
  mercadoLivre: (env: Env) =>
    Boolean(
      env.MERCADO_LIVRE_APP_ID &&
        env.MERCADO_LIVRE_CLIENT_SECRET &&
        env.MERCADO_LIVRE_REFRESH_TOKEN,
    ),
  telegram: (env: Env) => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  x: (env: Env) =>
    Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET),
  openRouter: (env: Env) => Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL),
};
