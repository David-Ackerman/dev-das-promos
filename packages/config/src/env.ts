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
  // Required when admin and API use separate subdomains in production.
  SESSION_COOKIE_DOMAIN: z.string().optional(),
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

  /** Raw click-event retention; events older than this rolling window are deleted daily. */
  CLICK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(180),

  // Self-scheduled ingestion + publish routine (see apps/api/src/lib/scheduler.ts).
  // Off by default so dev/test/CI never spontaneously post to real
  // Telegram/X channels or spend OpenRouter quota just by booting the app.
  SCHEDULE_ENABLED: z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().default(false)),
  /** Comma-separated 24h UTC "HH:mm" times, e.g. "09:00,13:00,17:00,21:00". */
  SCHEDULE_TIMES: z
    .string()
    .regex(
      /^\d{2}:\d{2}(,\d{2}:\d{2})*$/,
      'SCHEDULE_TIMES must look like "09:00,13:00,17:00,21:00"',
    )
    .refine(
      (value) =>
        value.split(",").every((time) => {
          const hour = Number(time.slice(0, 2));
          const minute = Number(time.slice(3));
          return hour <= 23 && minute <= 59;
        }),
      "SCHEDULE_TIMES must contain valid 24-hour times",
    )
    .refine(
      (value) => new Set(value.split(",")).size === value.split(",").length,
      "SCHEDULE_TIMES must not contain duplicate times",
    )
    .default("09:00,13:00,17:00,21:00"),
  /** Comma-separated marketplace codes to ingest and publish each scheduled cycle. */
  SCHEDULE_MARKETPLACES: z
    .string()
    .default("shopee_br")
    .refine((value) => {
      const marketplaces = value.split(",").map((marketplace) => marketplace.trim());
      // Automatic publishing requires a server-generated affiliate URL.
      // Mercado Livre currently requires a human-created short link.
      const supported = new Set(["amazon_br", "shopee_br"]);
      return (
        marketplaces.length > 0 && marketplaces.every((marketplace) => supported.has(marketplace))
      );
    }, "SCHEDULE_MARKETPLACES must contain amazon_br and/or shopee_br (Mercado Livre links require manual setup)"),
  /** Gap between an ingestion trigger and the publish-ready-deals trigger, so evaluation has time to finish. */
  SCHEDULE_PUBLISH_DELAY_MINUTES: z.coerce.number().int().positive().default(15),
  /** Max deals published per scheduled run, so one cycle can't flood every channel at once. */
  SCHEDULE_PUBLISH_LIMIT: z.coerce.number().int().positive().default(1),
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

  if (parsed.data.NODE_ENV === "production") {
    let databasePassword = "";
    try {
      const databaseUrl = new URL(parsed.data.DATABASE_URL);
      if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
        throw new Error("unsupported protocol");
      }
      databasePassword = decodeURIComponent(databaseUrl.password);
    } catch {
      throw new Error("Production DATABASE_URL must be a valid PostgreSQL URL with a password");
    }
    if (databasePassword.length < 32) {
      throw new Error("Production DATABASE_URL password must be at least 32 characters");
    }

    const productionRequirements = [
      {
        name: "INTERNAL_API_TOKEN",
        value: parsed.data.INTERNAL_API_TOKEN,
        minimumLength: 32,
        exampleValue: "dev-internal-token-change-me",
      },
      {
        name: "AUTH_SECRET",
        value: parsed.data.AUTH_SECRET,
        minimumLength: 32,
        exampleValue: "dev-auth-secret-change-me-please-32chars",
      },
      {
        name: "ADMIN_PASSWORD",
        value: parsed.data.ADMIN_PASSWORD,
        minimumLength: 12,
        exampleValue: "change-me-please",
      },
    ];
    const unsafeSecrets = productionRequirements
      .filter(
        ({ value, minimumLength, exampleValue }) =>
          value.length < minimumLength || value === exampleValue,
      )
      .map(({ name }) => name);

    if (unsafeSecrets.length > 0) {
      const message = [
        "Production environment requires rotated secrets with sufficient length:",
        unsafeSecrets.join(", "),
      ].join(" ");
      throw new Error(message);
    }
    if (parsed.data.ADMIN_EMAIL.toLowerCase() === "admin@example.com") {
      throw new Error("Production environment requires a real ADMIN_EMAIL, not admin@example.com");
    }

    const apiUrl = new URL(parsed.data.API_URL);
    const adminUrl = new URL(parsed.data.ADMIN_URL);
    const publicWebUrl = new URL(parsed.data.PUBLIC_WEB_URL);
    if ([apiUrl, adminUrl, publicWebUrl].some((url) => url.protocol !== "https:")) {
      throw new Error("Production API_URL, ADMIN_URL, and PUBLIC_WEB_URL must use HTTPS");
    }
    if (
      [apiUrl, adminUrl, publicWebUrl].some(
        (url) =>
          url.username !== "" ||
          url.password !== "" ||
          url.pathname !== "/" ||
          url.search !== "" ||
          url.hash !== "",
      )
    ) {
      throw new Error(
        "Production API_URL, ADMIN_URL, and PUBLIC_WEB_URL must be HTTPS origins without credentials, paths, queries, or fragments",
      );
    }

    const apiHost = apiUrl.hostname;
    const adminHost = adminUrl.hostname;
    if (apiHost !== adminHost) {
      const cookieDomain = parsed.data.SESSION_COOKIE_DOMAIN?.replace(/^\./, "").toLowerCase();
      // The production deployment uses sibling hosts (api.<domain> and
      // admin.<domain>). Requiring their exact shared parent prevents an
      // invalid/public-suffix cookie domain such as `.com` from passing
      // startup validation and then being silently rejected by browsers.
      const sharedParent = (host: string) => {
        const labels = host.toLowerCase().split(".");
        return labels.length >= 3 ? labels.slice(1).join(".") : undefined;
      };
      const expectedParent = sharedParent(apiHost);
      if (
        !expectedParent ||
        sharedParent(adminHost) !== expectedParent ||
        cookieDomain !== expectedParent
      ) {
        throw new Error(
          "SESSION_COOKIE_DOMAIN must be the shared parent domain of sibling API_URL and ADMIN_URL hosts in production",
        );
      }
    }

    if (parsed.data.SCHEDULE_ENABLED) {
      const scheduledMarketplaces = parsed.data.SCHEDULE_MARKETPLACES.split(",").map((value) =>
        value.trim(),
      );
      const supportedScheduledMarketplaces = new Set(["amazon_br", "shopee_br"]);
      const unsupportedMarketplaces = scheduledMarketplaces.filter(
        (marketplace) => !supportedScheduledMarketplaces.has(marketplace),
      );
      if (scheduledMarketplaces.length === 0 || unsupportedMarketplaces.length > 0) {
        throw new Error(
          `SCHEDULE_ENABLED requires SCHEDULE_MARKETPLACES to contain only amazon_br and/or shopee_br; received: ${parsed.data.SCHEDULE_MARKETPLACES}`,
        );
      }
      if (new Set(scheduledMarketplaces).size !== scheduledMarketplaces.length) {
        throw new Error("SCHEDULE_MARKETPLACES must not contain duplicate marketplaces");
      }

      const missingMarketplaceCredentials = scheduledMarketplaces.filter((marketplace) => {
        if (marketplace === "amazon_br") {
          return !(
            parsed.data.AMAZON_CREATORS_CLIENT_ID &&
            parsed.data.AMAZON_CREATORS_CLIENT_SECRET &&
            parsed.data.AMAZON_AFFILIATE_TAG
          );
        }
        return !(parsed.data.SHOPEE_APP_ID && parsed.data.SHOPEE_APP_SECRET);
      });
      if (missingMarketplaceCredentials.length > 0) {
        throw new Error(
          `SCHEDULE_ENABLED requires real marketplace credentials for: ${missingMarketplaceCredentials.join(", ")}`,
        );
      }

      const hasExternalPublisher = Boolean(
        (parsed.data.TELEGRAM_BOT_TOKEN && parsed.data.TELEGRAM_CHAT_ID) ||
          (parsed.data.X_API_KEY &&
            parsed.data.X_API_SECRET &&
            parsed.data.X_ACCESS_TOKEN &&
            parsed.data.X_ACCESS_TOKEN_SECRET),
      );
      if (!hasExternalPublisher) {
        throw new Error(
          "SCHEDULE_ENABLED requires credentials for at least one external publisher (Telegram or X)",
        );
      }
    }
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
