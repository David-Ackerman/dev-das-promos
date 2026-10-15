import { generateCaption } from "./ai.ts";
import { approvePost } from "./publish.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { previewHtml, retryKeyboard, sendPreview, statusHeader, updatePreview } from "./preview.ts";
import { fetchAmazonCandidates } from "./providers/amazon.ts";
import { fetchShopeeCandidates, shopeeAffiliateLink } from "./providers/shopee.ts";
import {
  createPost,
  dbNow,
  expireStalePending,
  failStuckPublishing,
  lowestSeenPrices,
  recentlyUsedProductIds,
  transition,
  upsertProduct,
} from "./repo.ts";
import { sendText } from "./telegram.ts";
import type { Candidate, Marketplace, PostRow } from "./types.ts";
import { errorMessage, escapeHtml, randomCode } from "./util.ts";

export interface CollectDeps {
  fetchAmazon?: (cfg: NonNullable<Config["amazon"]>) => Promise<Candidate[]>;
  fetchShopee?: (cfg: NonNullable<Config["shopee"]>) => Promise<Candidate[]>;
  log?: (msg: string) => void;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** True when the title has a blocked word or phrase. Whole words, accents ignored ("capa" ≠ "capacidade"). */
export function isBlocked(title: string, blockedWords: string[]): boolean {
  const t = ` ${normalize(title).replace(/[^a-z0-9]+/g, " ")} `;
  return blockedWords.some((w) => {
    const word = normalize(w).replace(/[^a-z0-9]+/g, " ").trim();
    return word !== "" && t.includes(` ${word} `);
  });
}

/** What one sale pays us, in cents. Shopee sends the rate as a fraction ("0.08"); some feeds use percent. */
export function commissionCents(c: Candidate): number {
  if (!c.commissionRate || c.commissionRate <= 0) return 0;
  const rate = c.commissionRate > 1 ? c.commissionRate / 100 : c.commissionRate;
  return Math.round(c.priceCents * rate);
}

/**
 * Higher is better: the discount (what makes people click) first, then what a
 * sale pays us, then popularity and rating. Commission is on a log scale so a
 * pricey item can't win on commission alone: R$ 2 ≈ 4 points, R$ 20 ≈ 11, R$ 100+ = 16.
 */
export function score(c: Candidate): number {
  const popularity = c.sales ? Math.min(Math.log10(c.sales + 1) * 4, 16) : 0;
  const rating = c.rating ? Math.max(0, (c.rating - 4) * 5) : 0;
  const commission = Math.min(Math.log10(commissionCents(c) / 100 + 1) * 8, 16);
  return c.discountPct + popularity + rating + commission;
}

/** "Was cheaper in the last 30 days" (2% tolerance, so cents of noise don't count). */
export function isFakeDiscount(priceCents: number, lowestSeenCents: number | undefined): boolean {
  return lowestSeenCents !== undefined && lowestSeenCents < priceCents * 0.98;
}

/** Best deals first, alternating stores so one marketplace doesn't take every slot. */
export function pickCandidates(
  candidates: Candidate[],
  opts: { limit: number; minDiscountPct: number; exclude?: (c: Candidate) => boolean },
): Candidate[] {
  const seen = new Set<string>();
  const eligible = candidates
    .filter((c) => c.discountPct >= opts.minDiscountPct)
    .filter((c) => !opts.exclude?.(c))
    .filter((c) => {
      const key = `${c.marketplace}:${c.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => score(b) - score(a));

  const queues = new Map<Marketplace, Candidate[]>();
  for (const c of eligible) queues.set(c.marketplace, [...(queues.get(c.marketplace) ?? []), c]);
  const out: Candidate[] = [];
  while (out.length < opts.limit && [...queues.values()].some((q) => q.length)) {
    for (const q of queues.values()) {
      const next = q.shift();
      if (next && out.length < opts.limit) out.push(next);
    }
  }
  return out;
}

async function affiliateUrlFor(cfg: Config, c: Candidate, ref: string): Promise<string> {
  if (c.marketplace !== "shopee") return c.productUrl; // Amazon vends it already tagged
  if (!cfg.shopee) throw new Error("Shopee not configured");
  return shopeeAffiliateLink(cfg.shopee, c.productUrl, ref);
}

/** After this long in "publishing" the Worker is certainly gone (it gets ~30s). */
const STUCK_PUBLISHING_MINUTES = 15;

/** Auto-approve rule: big enough discount, real AI text, and not a fake discount. */
export function shouldAutoApprove(cfg: Config, post: PostRow): boolean {
  const min = cfg.autoApproveMinDiscountPct;
  if (min <= 0 || post.discount_pct < min || post.ai_model === "template") return false;
  return !isFakeDiscount(post.price_cents, post.lowest_seen_cents ?? undefined);
}

export interface CollectResult {
  found: number;
  previews: number;
  autoApproved: number;
  expired: number;
  errors: string[];
}

export async function runCollect(
  cfg: Config,
  db: Db,
  deps: CollectDeps = {},
  opts: { dryRun?: boolean } = {},
): Promise<CollectResult> {
  const log = deps.log ?? console.log;
  const result: CollectResult = { found: 0, previews: 0, autoApproved: 0, expired: 0, errors: [] };

  if (!opts.dryRun) {
    for (const post of await expireStalePending(db, cfg.selection.pendingTtlHours)) {
      result.expired++;
      await updatePreview(cfg, post, statusHeader(post, "⏰", "Expirou sem aprovação"), []).catch(() => {});
    }
    for (const post of await failStuckPublishing(db, STUCK_PUBLISHING_MINUTES)) {
      await updatePreview(cfg, post, statusHeader(post, "⚠️", "Travou ao publicar"), retryKeyboard(post)).catch(() => {});
    }
  }

  const candidates: Candidate[] = [];
  const sources: [string, () => Promise<Candidate[]>][] = [];
  if (cfg.amazon) sources.push(["Amazon", () => (deps.fetchAmazon ?? fetchAmazonCandidates)(cfg.amazon!)]);
  if (cfg.shopee) sources.push(["Shopee", () => (deps.fetchShopee ?? fetchShopeeCandidates)(cfg.shopee!)]);
  if (!sources.length) throw new Error("No marketplace configured: set the AMAZON_* and/or SHOPEE_* settings.");

  for (const [name, fetchFn] of sources) {
    try {
      const found = await fetchFn();
      log(`${name}: ${found.length} offers`);
      candidates.push(...found);
    } catch (error) {
      result.errors.push(`${name}: ${errorMessage(error)}`);
      log(`${name} failed: ${errorMessage(error)}`);
    }
  }
  result.found = candidates.length;

  // Remember every product/price we saw (price history), and skip recent ones.
  const productIds = new Map<string, number>();
  let used = new Set<number>();
  let lowest = new Map<number, number>();
  if (!opts.dryRun) {
    const startedAt = await dbNow(db);
    for (const c of candidates) productIds.set(`${c.marketplace}:${c.externalId}`, await upsertProduct(db, c));
    used = await recentlyUsedProductIds(db, cfg.selection.cooldownDays);
    lowest = await lowestSeenPrices(db, [...new Set(productIds.values())], startedAt);
  }
  const idOf = (c: Candidate) => productIds.get(`${c.marketplace}:${c.externalId}`) ?? -1;
  const fake = (c: Candidate) => cfg.selection.skipFakeDiscounts && isFakeDiscount(c.priceCents, lowest.get(idOf(c)));
  const picks = pickCandidates(candidates, {
    limit: cfg.selection.postsPerRun,
    minDiscountPct: cfg.selection.minDiscountPct,
    exclude: (c) => used.has(idOf(c)) || isBlocked(c.title, cfg.selection.blockedWords) || fake(c),
  });
  const blocked = candidates.filter((c) => isBlocked(c.title, cfg.selection.blockedWords)).length;
  const fakes = candidates.filter(fake).length;
  log(
    `Picked ${picks.length} of ${candidates.length}` +
      (blocked ? ` (${blocked} skipped by BLOCKED_WORDS)` : "") +
      (fakes ? ` (${fakes} skipped: cheaper in the last 30 days)` : ""),
  );

  let aiError = "";
  for (const c of picks) {
    try {
      const ref = randomCode(10);
      // GitHub Actions has no 30s limit like the Worker: room for every model in AI_MODEL.
      const caption = await generateCaption(cfg.ai, c, undefined, 60_000);
      aiError ||= caption.error ?? "";
      if (opts.dryRun) {
        log(`\n--- [dry-run] ${c.marketplace} ${c.externalId} score=${score(c).toFixed(1)} ---`);
        log(
          previewHtml(cfg, {
            id: 0, product_id: 0, ref, status: "pending", price_cents: c.priceCents,
            original_price_cents: c.originalPriceCents ?? null, discount_pct: c.discountPct, lowest_seen_cents: null,
            affiliate_url: c.productUrl, caption: caption.caption, caption_short: caption.short, hashtag: caption.hashtag ?? null,
            ai_model: caption.model, preview_chat_id: null, preview_message_id: null,
            preview_has_photo: false, scheduled_at: null, marketplace: c.marketplace, title: c.title,
            image_url: c.imageUrl ?? null, product_url: c.productUrl,
          }),
        );
        result.previews++;
        continue;
      }
      const affiliateUrl = await affiliateUrlFor(cfg, c, ref);
      const productId = idOf(c);
      const post = await createPost(db, {
        productId,
        ref,
        candidate: c,
        affiliateUrl,
        lowestSeenCents: lowest.get(productId) ?? null,
        caption: caption.caption,
        captionShort: caption.short,
        hashtag: caption.hashtag,
        aiModel: caption.model,
      });
      try {
        await sendPreview(cfg, db, post);
      } catch (error) {
        // Nobody can approve a preview that never arrived; don't leave it pending.
        await transition(db, post.id, "pending", "failed");
        throw error;
      }
      result.previews++;
      if (shouldAutoApprove(cfg, post)) {
        log(`Auto-approved #${post.id}: ${await approvePost(cfg, db, post.id, { auto: true })}`);
        result.autoApproved++;
      }
    } catch (error) {
      result.errors.push(`${c.marketplace} ${c.externalId}: ${errorMessage(error)}`);
      log(`Failed to prepare ${c.externalId}: ${errorMessage(error)}`);
    }
  }

  if (aiError) result.errors.push(`IA falhou, usei texto padrão: ${aiError}`);

  if (!opts.dryRun && (result.errors.length || result.previews === 0)) {
    const msg = [
      result.previews === 0 ? `🤷 Nenhuma promoção nova acima de ${cfg.selection.minDiscountPct}% nesta rodada.` : "",
      ...result.errors.map((e) => `⚠️ ${escapeHtml(e)}`),
    ]
      .filter(Boolean)
      .join("\n");
    await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, msg).catch(() => {});
  }
  return result;
}
