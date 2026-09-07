import { beforeEach, describe, expect, it } from "vitest";
import { type Env, integrationStatus, loadEnv, resetEnvCache } from "../env.js";

function baseSource(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgres://localhost:5432/das_promos",
    REDIS_URL: "redis://localhost:6379",
    INTERNAL_API_TOKEN: "a-token-that-is-long-enough",
    AUTH_SECRET: "a-secret-that-is-long-enough",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  resetEnvCache();
});

describe("loadEnv", () => {
  it("parses a valid config and returns typed values", () => {
    const env = loadEnv(baseSource());
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/das_promos");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.INTERNAL_API_TOKEN).toBe("a-token-that-is-long-enough");
    expect(env.AUTH_SECRET).toBe("a-secret-that-is-long-enough");
  });

  it("throws a readable error when DATABASE_URL is missing", () => {
    const source = baseSource();
    delete (source as Record<string, unknown>).DATABASE_URL;
    expect(() => loadEnv(source)).toThrowError(/DATABASE_URL/);
  });

  it("throws a readable error when REDIS_URL is missing", () => {
    const source = baseSource();
    delete (source as Record<string, unknown>).REDIS_URL;
    expect(() => loadEnv(source)).toThrowError(/REDIS_URL/);
  });

  it("lists every failing field in a single error when multiple are missing", () => {
    const source = baseSource();
    delete (source as Record<string, unknown>).DATABASE_URL;
    delete (source as Record<string, unknown>).REDIS_URL;
    try {
      loadEnv(source);
      throw new Error("expected loadEnv to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("REDIS_URL");
    }
  });

  it("throws when INTERNAL_API_TOKEN is shorter than 16 characters", () => {
    const source = baseSource({ INTERNAL_API_TOKEN: "short" });
    expect(() => loadEnv(source)).toThrowError(/INTERNAL_API_TOKEN/);
  });

  it("throws when AUTH_SECRET is shorter than 16 characters", () => {
    const source = baseSource({ AUTH_SECRET: "short" });
    expect(() => loadEnv(source)).toThrowError(/AUTH_SECRET/);
  });

  it("applies defaults for optional fields when they are omitted", () => {
    const env = loadEnv(baseSource());
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(4000);
    expect(env.API_URL).toBe("http://localhost:4000");
    expect(env.ADMIN_URL).toBe("http://localhost:3001");
    expect(env.PUBLIC_WEB_URL).toBe("http://localhost:3000");
    expect(env.ADMIN_EMAIL).toBe("admin@example.com");
    expect(env.ADMIN_PASSWORD).toBe("change-me-please");
    expect(env.AMAZON_AFFILIATE_TAG).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_MODEL).toBeUndefined();
    expect(env.AI_CONTENT_DAILY_LIMIT).toBe(10);
  });

  it("coerces API_PORT from a string to a number", () => {
    const env = loadEnv(baseSource({ API_PORT: "5000" }));
    expect(env.API_PORT).toBe(5000);
  });

  it("respects explicitly provided optional values instead of defaults", () => {
    const env = loadEnv(
      baseSource({
        NODE_ENV: "production",
        API_PORT: "8080",
        AMAZON_AFFILIATE_TAG: "das-promos-20",
      }),
    );
    expect(env.NODE_ENV).toBe("production");
    expect(env.API_PORT).toBe(8080);
    expect(env.AMAZON_AFFILIATE_TAG).toBe("das-promos-20");
  });

  it("memoizes the parsed env and ignores a differing source on subsequent calls", () => {
    const first = loadEnv(baseSource({ NODE_ENV: "production" }));
    const second = loadEnv(baseSource({ NODE_ENV: "test" }));
    expect(first).toBe(second);
    expect(second.NODE_ENV).toBe("production");
  });

  it("re-parses after resetEnvCache is called", () => {
    loadEnv(baseSource({ NODE_ENV: "production" }));
    resetEnvCache();
    const env = loadEnv(baseSource({ NODE_ENV: "test" }));
    expect(env.NODE_ENV).toBe("test");
  });
});

describe("integrationStatus", () => {
  function envWith(overrides: Partial<Env>): Env {
    return { ...loadEnv(baseSource()), ...overrides };
  }

  it("amazonAffiliate is true only when AMAZON_AFFILIATE_TAG is present", () => {
    expect(integrationStatus.amazonAffiliate(envWith({ AMAZON_AFFILIATE_TAG: "tag" }))).toBe(true);
    expect(integrationStatus.amazonAffiliate(envWith({ AMAZON_AFFILIATE_TAG: undefined }))).toBe(
      false,
    );
  });

  it("shopeeAffiliate is true only when SHOPEE_AFFILIATE_ID is present", () => {
    expect(integrationStatus.shopeeAffiliate(envWith({ SHOPEE_AFFILIATE_ID: "id" }))).toBe(true);
    expect(integrationStatus.shopeeAffiliate(envWith({ SHOPEE_AFFILIATE_ID: undefined }))).toBe(
      false,
    );
  });

  it("telegram requires both bot token and chat id", () => {
    expect(
      integrationStatus.telegram(
        envWith({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" }),
      ),
    ).toBe(true);
    expect(
      integrationStatus.telegram(
        envWith({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: undefined }),
      ),
    ).toBe(false);
    expect(
      integrationStatus.telegram(
        envWith({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: "chat" }),
      ),
    ).toBe(false);
    expect(integrationStatus.telegram(envWith({}))).toBe(false);
  });

  it("x requires all four X/Twitter credentials", () => {
    const allPresent = envWith({
      X_API_KEY: "key",
      X_API_SECRET: "secret",
      X_ACCESS_TOKEN: "token",
      X_ACCESS_TOKEN_SECRET: "token-secret",
    });
    expect(integrationStatus.x(allPresent)).toBe(true);

    const missingOne = envWith({
      X_API_KEY: "key",
      X_API_SECRET: "secret",
      X_ACCESS_TOKEN: "token",
      X_ACCESS_TOKEN_SECRET: undefined,
    });
    expect(integrationStatus.x(missingOne)).toBe(false);
    expect(integrationStatus.x(envWith({}))).toBe(false);
  });

  it("openRouter is true only when both OPENROUTER_API_KEY and OPENROUTER_MODEL are present", () => {
    expect(
      integrationStatus.openRouter(
        envWith({ OPENROUTER_API_KEY: "key", OPENROUTER_MODEL: "z-ai/glm-5.2:free" }),
      ),
    ).toBe(true);
    expect(
      integrationStatus.openRouter(
        envWith({ OPENROUTER_API_KEY: "key", OPENROUTER_MODEL: undefined }),
      ),
    ).toBe(false);
    expect(
      integrationStatus.openRouter(
        envWith({ OPENROUTER_API_KEY: undefined, OPENROUTER_MODEL: "z-ai/glm-5.2:free" }),
      ),
    ).toBe(false);
    expect(integrationStatus.openRouter(envWith({}))).toBe(false);
  });
});
