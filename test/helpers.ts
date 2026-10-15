import type { Config } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";

export interface Call {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

type Route = (call: Call) => unknown | Response | Promise<unknown | Response>;

/** Replaces global fetch. Routes match by URL substring; first match wins. */
export function mockFetch(routes: [string | RegExp, Route][]) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    let body: any = init.body;
    try {
      body = body ? JSON.parse(body) : undefined;
    } catch {}
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    const call: Call = { url, method: init.method ?? "GET", body, headers };
    calls.push(call);
    for (const [match, route] of routes) {
      if (typeof match === "string" ? url.includes(match) : match.test(url)) {
        const out = await route(call);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: `no mock for ${url}` }), { status: 500 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    to: (part: string) => calls.filter((c) => c.url.includes(part)),
  };
}

let messageId = Date.now() % 1_000_000_000;
/** Fake Telegram Bot API: every method succeeds. */
export function telegramRoute(): Route {
  return () => ({ ok: true, result: { message_id: ++messageId, url: "x", pending_update_count: 0 } });
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/promos_test",
    PUBLIC_BASE_URL: "https://promo.example.workers.dev",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_ADMIN_CHAT_ID: "111",
    TELEGRAM_WEBHOOK_SECRET: "secret_secret_secret",
    TELEGRAM_GROUP_IDS: "-1001,-1002",
    SHOPEE_APP_ID: "app",
    SHOPEE_APP_SECRET: "shh",
    AI_API_KEY: "k",
    AI_MODEL: "test/model:free",
    MIN_DISCOUNT_PCT: "20",
    POSTS_PER_RUN: "2",
    QUEUE_INTERVAL_MINUTES: "0",
    ...overrides,
  });
}
