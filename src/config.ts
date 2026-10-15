import { parsePostingHours, type QueueSettings } from "./schedule.ts";

/**
 * All settings come from environment variables (GitHub secrets/vars for the
 * cron job, Worker secrets/vars for the Cloudflare Worker, `.env` locally).
 * See `.env.example` for what each one does.
 */
export type Env = Record<string, string | undefined>;

export type WhatsAppMode = "share" | "evolution" | "zapi" | "off";
export type XMode = "share" | "off" | "link" | "no-link";

export interface Config {
  databaseUrl: string;
  /** Public URL of the Cloudflare Worker, e.g. https://das-promos.you.workers.dev */
  publicBaseUrl: string;
  telegram: {
    botToken: string;
    /** Where previews are sent (your private chat with the bot, or a private admin group). */
    adminChatId: string;
    /** Telegram user ids allowed to tap Approve/Decline. Defaults to adminChatId. */
    adminUserIds: string[];
    webhookSecret: string;
    /** Public groups/channels that receive approved posts. */
    groupChatIds: string[];
  };
  whatsapp: {
    mode: WhatsAppMode;
    groupIds: string[];
    evolution?: { baseUrl: string; apiKey: string; instance: string };
    zapi?: { instanceId: string; token: string; clientToken: string };
  };
  x: {
    mode: XMode;
    credentials?: { apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string };
    /** Shown instead of the link when mode is "no-link". */
    noLinkText: string;
  };
  amazon?: {
    clientId: string;
    clientSecret: string;
    partnerTag: string;
    keywords: string[];
    tokenUrl: string;
  };
  shopee?: {
    appId: string;
    appSecret: string;
    keywords: string[];
    sortType: number;
  };
  /** `models` are tried in order: free models are often busy (HTTP 429). */
  ai: {
    baseUrl: string;
    apiKey?: string;
    models: string[];
    /** Who the group is for (NICHE), so the jokes fit the audience. */
    niche?: string;
  };
  selection: {
    postsPerRun: number;
    minDiscountPct: number;
    cooldownDays: number;
    pendingTtlHours: number;
    /** Offers whose title has any of these words are skipped (BLOCKED_WORDS). */
    blockedWords: string[];
    /** Skip offers that were cheaper in the last 30 days: the "discount" isn't real. */
    skipFakeDiscounts: boolean;
  };
  /** Approved posts are spaced out inside a posting window (see schedule.ts). */
  queue: QueueSettings;
  /** Previews with at least this discount (and real AI text, no fake discount) are approved automatically. 0 = off. */
  autoApproveMinDiscountPct: number;
  /** Public deals page (GET /). */
  site: { name: string; telegramUrl?: string; whatsappUrl?: string };
  footer: string;
  githubDispatch?: { token: string; repo: string; workflow: string; ref: string };
}

export function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  return !["false", "0", "no", "nao", "não", "off"].includes(v);
}

/** Only https links end up on the public page. */
function httpsUrl(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && /^https:\/\/\S+$/.test(v) ? v : undefined;
}

function req(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing required setting ${name} (see .env.example)`);
  return v;
}

const DEFAULT_KEYWORDS = "fone bluetooth,air fryer,smartwatch,cafeteira,mouse gamer";

export function loadConfig(env: Env): Config {
  const botToken = req(env, "TELEGRAM_BOT_TOKEN");
  const adminChatId = req(env, "TELEGRAM_ADMIN_CHAT_ID");
  const adminUserIds = list(env.TELEGRAM_ADMIN_USER_IDS);

  const waMode = (env.WHATSAPP_MODE?.trim() || "share") as WhatsAppMode;
  if (!["share", "evolution", "zapi", "off"].includes(waMode)) {
    throw new Error(`WHATSAPP_MODE must be share | evolution | zapi | off (got "${waMode}")`);
  }
  const xMode = (env.X_MODE?.trim() || "share") as XMode;
  if (!["share", "off", "link", "no-link"].includes(xMode)) {
    throw new Error(`X_MODE must be share | off | link | no-link (got "${xMode}")`);
  }

  const config: Config = {
    databaseUrl: req(env, "DATABASE_URL"),
    publicBaseUrl: req(env, "PUBLIC_BASE_URL").replace(/\/+$/, ""),
    telegram: {
      botToken,
      adminChatId,
      adminUserIds: adminUserIds.length ? adminUserIds : [adminChatId],
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "",
      groupChatIds: list(env.TELEGRAM_GROUP_IDS),
    },
    whatsapp: { mode: waMode, groupIds: list(env.WHATSAPP_GROUP_IDS) },
    x: {
      mode: xMode,
      noLinkText: env.X_NO_LINK_TEXT?.trim() || "🔗 Link na bio",
    },
    ai: {
      baseUrl: (env.AI_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
      apiKey: env.AI_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || undefined,
      models: list(env.AI_MODEL || env.OPENROUTER_MODEL),
      niche: env.NICHE?.trim() || undefined,
    },
    selection: {
      postsPerRun: int(env.POSTS_PER_RUN, 2),
      minDiscountPct: int(env.MIN_DISCOUNT_PCT, 20),
      cooldownDays: int(env.REPOST_COOLDOWN_DAYS, 14),
      pendingTtlHours: int(env.PENDING_TTL_HOURS, 12),
      blockedWords: list(env.BLOCKED_WORDS),
      skipFakeDiscounts: bool(env.SKIP_FAKE_DISCOUNTS, true),
    },
    queue: { intervalMinutes: Math.max(0, int(env.QUEUE_INTERVAL_MINUTES, 40)), ...parsePostingHours(env.POSTING_HOURS) },
    autoApproveMinDiscountPct: Math.max(0, int(env.AUTO_APPROVE_MIN_DISCOUNT, 0)),
    site: {
      name: env.SITE_NAME?.trim() || "Promoções do dia",
      telegramUrl: httpsUrl(env.SITE_TELEGRAM_URL),
      whatsappUrl: httpsUrl(env.SITE_WHATSAPP_URL),
    },
    footer: env.POST_FOOTER?.trim() ?? "#publi · link de afiliado",
  };

  if (env.AMAZON_CLIENT_ID && env.AMAZON_CLIENT_SECRET) {
    config.amazon = {
      clientId: env.AMAZON_CLIENT_ID.trim(),
      clientSecret: req(env, "AMAZON_CLIENT_SECRET"),
      partnerTag: req(env, "AMAZON_PARTNER_TAG"),
      keywords: list(env.AMAZON_KEYWORDS || DEFAULT_KEYWORDS),
      tokenUrl: env.AMAZON_TOKEN_URL?.trim() || "https://api.amazon.com/auth/o2/token",
    };
  }
  if (env.SHOPEE_APP_ID && env.SHOPEE_APP_SECRET) {
    config.shopee = {
      appId: env.SHOPEE_APP_ID.trim(),
      appSecret: env.SHOPEE_APP_SECRET.trim(),
      keywords: list(env.SHOPEE_KEYWORDS || DEFAULT_KEYWORDS),
      sortType: int(env.SHOPEE_SORT_TYPE, 2),
    };
  }

  if (waMode === "evolution") {
    config.whatsapp.evolution = {
      baseUrl: req(env, "EVOLUTION_API_URL").replace(/\/+$/, ""),
      apiKey: req(env, "EVOLUTION_API_KEY"),
      instance: req(env, "EVOLUTION_INSTANCE"),
    };
  }
  if (waMode === "zapi") {
    config.whatsapp.zapi = {
      instanceId: req(env, "ZAPI_INSTANCE_ID"),
      token: req(env, "ZAPI_TOKEN"),
      clientToken: req(env, "ZAPI_CLIENT_TOKEN"),
    };
  }
  if (xMode === "link" || xMode === "no-link") {
    config.x.credentials = {
      apiKey: req(env, "X_API_KEY"),
      apiSecret: req(env, "X_API_SECRET"),
      accessToken: req(env, "X_ACCESS_TOKEN"),
      accessTokenSecret: req(env, "X_ACCESS_TOKEN_SECRET"),
    };
  }
  if (env.GH_DISPATCH_TOKEN && env.GH_REPO) {
    config.githubDispatch = {
      token: env.GH_DISPATCH_TOKEN.trim(),
      repo: env.GH_REPO.trim(),
      workflow: env.GH_COLLECT_WORKFLOW?.trim() || "collect.yml",
      ref: env.GH_REF?.trim() || "main",
    };
  }
  return config;
}
