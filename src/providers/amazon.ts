import type { Config } from "../config.ts";
import type { Candidate } from "../types.ts";
import { discountPct, sleep, toCents } from "../util.ts";

/**
 * Amazon Creators API (replaced PA-API 5.0 in 2026), Brazil marketplace.
 * Register at https://affiliate-program.amazon.com/creatorsapi — old PA-API
 * keys do not work. Auth is OAuth2 client-credentials.
 *
 * The `detailPageURL` Amazon returns already carries your partner tag and is
 * the affiliate link. Amazon warns that changing it can lose attribution, so
 * we keep it byte-for-byte and do channel tracking in our own /go redirect.
 */
const API_BASE = "https://creatorsapi.amazon/catalog/v1";
const MARKETPLACE = "www.amazon.com.br";
// Each sub-field must be named; the bare "offersV2" is rejected with HTTP 400.
const RESOURCES = [
  "images.primary.large",
  "itemInfo.title",
  "offersV2.listings.price",
  "offersV2.listings.availability",
];

type AmazonConfig = NonNullable<Config["amazon"]>;

interface Money {
  amount?: number;
  currency?: string;
}
interface Item {
  asin: string;
  detailPageURL?: string;
  itemInfo?: { title?: { displayValue?: string } };
  images?: { primary?: { large?: { url?: string } } };
  offersV2?: {
    listings?: {
      price?: { money?: Money; savingBasis?: { money?: Money } };
      availability?: { type?: string };
    }[];
  };
}

let cachedToken: { value: string; expiresAt: number } | undefined;

async function token(cfg: AmazonConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "creatorsapi::default",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`Amazon token request failed: HTTP ${res.status} ${body.error_description ?? ""}`);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

async function call(cfg: AmazonConfig, path: string, body: unknown): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token(cfg)}`,
        "content-type": "application/json",
        "x-marketplace": MARKETPLACE,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const err = (await res.json().catch(() => ({}))) as {
      errors?: { code?: string; message?: string }[];
      message?: string;
    };
    throw new Error(
      `Amazon ${path} error [${err.errors?.[0]?.code ?? res.status}]: ${err.errors?.[0]?.message ?? err.message ?? res.statusText}`,
    );
  }
  throw new Error(`Amazon ${path}: too many retries`);
}

export function isVendedAmazonUrl(raw: string, partnerTag: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "amazon.com.br" || host === "www.amazon.com.br") &&
      url.searchParams.get("tag") === partnerTag
    );
  } catch {
    return false;
  }
}

export function amazonItemToCandidate(item: Item, partnerTag: string): Candidate | null {
  if (!item.detailPageURL || !isVendedAmazonUrl(item.detailPageURL, partnerTag)) return null;
  const listing = item.offersV2?.listings?.[0];
  if (listing?.availability?.type === "OUT_OF_STOCK") return null;
  const money = listing?.price?.money;
  if (typeof money?.amount !== "number" || money.amount <= 0) return null;
  if (money.currency && money.currency !== "BRL") return null;
  const priceCents = toCents(money.amount) as number;
  const basis = listing?.price?.savingBasis?.money?.amount;
  const originalPriceCents =
    typeof basis === "number" && basis > money.amount ? toCents(basis) : undefined;
  return {
    marketplace: "amazon",
    externalId: item.asin,
    title: item.itemInfo?.title?.displayValue ?? item.asin,
    imageUrl: item.images?.primary?.large?.url,
    productUrl: item.detailPageURL,
    priceCents,
    originalPriceCents,
    discountPct: discountPct(priceCents, originalPriceCents),
  };
}

export async function fetchAmazonCandidates(cfg: AmazonConfig): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const keywords of cfg.keywords) {
    const body = (await call(cfg, "/searchItems", {
      keywords,
      partnerTag: cfg.partnerTag,
      marketplace: MARKETPLACE,
      itemCount: 10,
      itemPage: 1,
      resources: RESOURCES,
    })) as { searchResult?: { items?: Item[] } };
    for (const item of body.searchResult?.items ?? []) {
      const c = amazonItemToCandidate(item, cfg.partnerTag);
      if (c) out.push(c);
    }
  }
  return out;
}
