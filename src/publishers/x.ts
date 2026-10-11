import type { Config } from "../config.ts";

/**
 * Posts a tweet with OAuth 1.0a user context (HMAC-SHA1 via WebCrypto, so it
 * runs in Cloudflare Workers too). X's API is pay-per-use since 2026: posts
 * that contain a link cost much more, which is why X_MODE=no-link exists.
 */
type XCreds = NonNullable<Config["x"]["credentials"]>;
const TWEETS_URL = "https://api.x.com/2/tweets";

function pct(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function oauthHeader(
  method: string,
  url: string,
  creds: XCreds,
  nonce = crypto.randomUUID().replace(/-/g, ""),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k] as string)}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const signature = await hmacSha1Base64(`${pct(creds.apiSecret)}&${pct(creds.accessTokenSecret)}`, base);
  const all = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}="${pct(all[k as keyof typeof all])}"`)
    .join(", ")}`;
}

export async function postTweet(creds: XCreds, text: string): Promise<string> {
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await oauthHeader("POST", TWEETS_URL, creds),
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { id: string };
    detail?: string;
    title?: string;
    errors?: { message?: string; detail?: string }[];
  };
  if (!res.ok || !body.data?.id) {
    const msg = body.errors?.map((e) => e.detail ?? e.message).join("; ") || body.detail || body.title;
    throw new Error(`X: ${msg ?? `HTTP ${res.status}`}`);
  }
  return body.data.id;
}
