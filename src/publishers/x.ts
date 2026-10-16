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

export async function postTweet(
  creds: XCreds,
  text: string,
  opts: { mediaIds?: string[]; replyTo?: string } = {},
): Promise<string> {
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await oauthHeader("POST", TWEETS_URL, creds),
    },
    body: JSON.stringify({
      text,
      ...(opts.mediaIds?.length ? { media: { media_ids: opts.mediaIds } } : {}),
      ...(opts.replyTo ? { reply: { in_reply_to_tweet_id: opts.replyTo } } : {}),
    }),
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

const MEDIA_URL = "https://api.x.com/2/media/upload";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The biggest version of a store's product photo: Amazon's 1500px variant,
 * Mercado Livre's original as JPEG, Shopee without the thumbnail suffix.
 */
export function bestImageUrl(url: string): string {
  if (/m\.media-amazon\.com\/images\//.test(url)) return url.replace(/\._[^/.]*_\.(jpe?g|png|webp)$/i, "._AC_SL1500_.$1");
  if (/mlstatic\.com\//.test(url)) return url.replace(/-[A-Z]\.(webp|jpe?g|png)$/i, "-O.jpg");
  if (/shopee|susercontent/.test(url)) return url.replace(/_tn$/, "");
  return url;
}

async function downloadImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | undefined> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  const type = res?.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!res?.ok || !IMAGE_TYPES.includes(type)) return undefined;
  const bytes = await res.arrayBuffer();
  return bytes.byteLength > 1000 && bytes.byteLength <= MAX_IMAGE_BYTES ? { bytes, type } : undefined;
}

/** Uploads the product photo (best variant, else the original) and returns its media id; undefined without a usable image. */
export async function uploadProductImage(creds: XCreds, imageUrl: string | null): Promise<string | undefined> {
  if (!imageUrl) return undefined;
  const best = bestImageUrl(imageUrl);
  const image = (await downloadImage(best)) ?? (best !== imageUrl ? await downloadImage(imageUrl) : undefined);
  if (!image) return undefined;
  const form = new FormData();
  form.append("media", new Blob([image.bytes], { type: image.type }), `product.${image.type.split("/")[1]}`);
  form.append("media_category", "tweet_image");
  const res = await fetch(MEDIA_URL, {
    method: "POST",
    headers: { authorization: await oauthHeader("POST", MEDIA_URL, creds) },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { id?: string };
    media_id_string?: string;
    detail?: string;
    errors?: { message?: string }[];
  };
  const id = body.data?.id ?? body.media_id_string;
  if (!res.ok || !id) throw new Error(`X media: ${body.errors?.[0]?.message ?? body.detail ?? `HTTP ${res.status}`}`);
  return id;
}
