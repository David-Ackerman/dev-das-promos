import { candidateFromPost, generateCaption, SEARCH_CAPTION } from "./ai.ts";
import { ensureWhatsAppConnected, relinkMessage } from "./publishers/whatsapp.ts";
import { approvePost, autoApproveOk, flagEndedDeals } from "./publish.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { pendingKeyboard, previewHtml, retryKeyboard, SEARCH_AGAIN, sendPreview, statusHeader, updatePreview } from "./preview.ts";
import { decideImage } from "./images.ts";
import { fetchAmazonCandidates } from "./providers/amazon.ts";
import { fetchAmazonScrapedCandidates } from "./providers/amazon-scrape.ts";
import { fetchShopeeCandidates, shopeeAffiliateLink } from "./providers/shopee.ts";
import { productFamily, productKind, qualityProblem, topicsForRun } from "./quality.ts";
import { ADMIN_CAPTION_MINUTES, NEEDS_ADMIN, nicheFit, writeReviewedCaption } from "./review.ts";
import {
  createPost,
  dbNow,
  expireStalePending,
  failStuckPublishing,
  generatedImagesToday,
  getPost,
  pendingTemplatePosts,
  lowestSeenPrices,
  recentCaptions,
  recentDealTitles,
  recentlyUsedProductIds,
  transition,
  updateCaption,
  upsertProducts,
} from "./repo.ts";
import { sendText } from "./telegram.ts";
import type { Candidate, Marketplace, PostRow } from "./types.ts";
import { errorMessage, escapeHtml, hasAnyWord, randomCode } from "./util.ts";

export interface CollectDeps {
  fetchAmazon?: (cfg: NonNullable<Config["amazon"]>) => Promise<Candidate[]>;
  fetchShopee?: (cfg: NonNullable<Config["shopee"]>) => Promise<Candidate[]>;
  fetchAmazonScrape?: typeof fetchAmazonScrapedCandidates;
  log?: (msg: string) => void;
}

/** True when the title has a blocked word or phrase. Whole words, accents ignored ("capa" ≠ "capacidade"). */
export function isBlocked(title: string, blockedWords: string[]): boolean {
  return hasAnyWord(title, blockedWords);
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
  opts: {
    limit: number;
    minDiscountPct: number;
    exclude?: (c: Candidate) => boolean;
    /** At most `maxPerKind` of one kind, counting `kindCounts` (what already went out today). */
    kindOf?: (c: Candidate) => string;
    maxPerKind?: number;
    kindCounts?: Map<string, number>;
    /** More "at most N per group" rules (search term, theme...). An empty group isn't limited. */
    limits?: { of: (c: Candidate) => string | undefined; max: number; counts?: Map<string, number> }[];
  },
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
  const limits = [
    ...(opts.kindOf && opts.maxPerKind ? [{ of: opts.kindOf, max: opts.maxPerKind, counts: opts.kindCounts }] : []),
    ...(opts.limits ?? []),
  ].map((l) => ({ ...l, used: new Map(l.counts ?? []) }));
  const fits = (c: Candidate) => {
    const keys = limits.map((l) => l.of(c));
    if (limits.some((l, i) => keys[i] && (l.used.get(keys[i]!) ?? 0) >= l.max)) return false;
    limits.forEach((l, i) => keys[i] && l.used.set(keys[i]!, (l.used.get(keys[i]!) ?? 0) + 1));
    return true;
  };
  const out: Candidate[] = [];
  while (out.length < opts.limit && [...queues.values()].some((q) => q.length)) {
    for (const q of queues.values()) {
      let next = q.shift();
      while (next && !fits(next)) next = q.shift();
      if (next && out.length < opts.limit) out.push(next);
    }
  }
  return out;
}

async function affiliateUrlFor(cfg: Config, c: Candidate, ref: string): Promise<string> {
  if (c.marketplace !== "shopee") return c.productUrl; // Amazon: the API vends it tagged; the search reader builds dp/<ASIN>?tag=
  if (!cfg.shopee) throw new Error("Shopee not configured");
  return shopeeAffiliateLink(cfg.shopee, c.productUrl, ref);
}

/** After this long in "publishing" the Worker is certainly gone (it gets ~30s). */
const STUCK_PUBLISHING_MINUTES = 15;

/** Auto-approve rule: big enough discount, real AI text, and not a fake discount. */
export function shouldAutoApprove(cfg: Config, post: PostRow): boolean {
  return autoApproveOk(cfg, post);
}

/**
 * Previews still waiting for the admin that fell back to a template (every model
 * was busy) get another AI try on each search run, so busy hours don't leave
 * them with a stock line. Edits the preview in place.
 */
export async function healTemplateCaptions(cfg: Config, db: Db, log: (msg: string) => void, limit = 4): Promise<number> {
  let healed = 0;
  for (const post of await pendingTemplatePosts(db, limit)) {
    const caption = await generateCaption(cfg.ai, candidateFromPost(post), post.caption, { ...SEARCH_CAPTION, recent: await recentCaptions(db) });
    if (caption.model === "template") continue;
    await updateCaption(db, post.id, caption.caption, caption.short, caption.model, caption.hashtag, caption.name);
    const fresh = await getPost(db, post.id);
    if (fresh?.status === "pending") await updatePreview(cfg, fresh, undefined, pendingKeyboard(fresh, cfg)).catch(() => {});
    log(`Preview #${post.id} got an AI text on retry (${caption.model})`);
    healed++;
  }
  return healed;
}

export interface CollectResult {
  found: number;
  previews: number;
  autoApproved: number;
  expired: number;
  /** Published deals found sold out / pricier this run (group messages edited). */
  ended: number;
  /** Earlier previews that fell back to a template and now got an AI text. */
  healed: number;
  errors: string[];
}

export async function runCollect(
  cfg: Config,
  db: Db,
  deps: CollectDeps = {},
  opts: { dryRun?: boolean } = {},
): Promise<CollectResult> {
  const log = deps.log ?? console.log;
  const result: CollectResult = { found: 0, previews: 0, autoApproved: 0, expired: 0, ended: 0, healed: 0, errors: [] };

  if (!opts.dryRun) {
    for (const post of await expireStalePending(db, cfg.selection.pendingTtlHours)) {
      result.expired++;
      await updatePreview(cfg, post, statusHeader(post, "⏰", "Expirou sem aprovação"), []).catch(() => {});
    }
    for (const post of await failStuckPublishing(db, STUCK_PUBLISHING_MINUTES)) {
      await updatePreview(cfg, post, statusHeader(post, "⚠️", "Travou ao publicar"), retryKeyboard(post)).catch(() => {});
    }
    result.healed = await healTemplateCaptions(cfg, db, log).catch((error) => {
      log(`Retrying template texts failed: ${errorMessage(error)}`);
      return 0;
    });
    try {
      result.ended = await flagEndedDeals(cfg, db, log);
    } catch (error) {
      log(`Checking published deals failed: ${errorMessage(error)}`);
    }
  }

  // WhatsApp through Evolution: reconnect a dropped session now, or tell the admin it needs a QR scan,
  // instead of finding out post by post.
  if (!opts.dryRun && cfg.whatsapp.mode === "evolution" && cfg.whatsapp.evolution) {
    const state = await ensureWhatsAppConnected(cfg.whatsapp).catch((e: unknown) => `erro: ${errorMessage(e)}`);
    if (state !== "open") result.errors.push(`${relinkMessage(cfg.whatsapp.evolution)} (estado: ${state})`);
    else log("WhatsApp (Evolution): connected");
  }

  const candidates: Candidate[] = [];
  const sources: [string, () => Promise<Candidate[]>][] = [];
  // A few broad topics per run, different each run and per store: a mix of everything over the day.
  const { topics, topicsPerRun } = cfg.selection;
  const amazonTopics = topicsForRun(topics, topicsPerRun, Date.now(), 0);
  const shopeeTopics = topicsForRun(topics, topicsPerRun, Date.now(), 1);
  if (cfg.amazon) {
    const amazon = { ...cfg.amazon, keywords: amazonTopics };
    sources.push(["Amazon", () => (deps.fetchAmazon ?? fetchAmazonCandidates)(amazon)]);
  }
  if (cfg.amazonScrape) {
    const scrape = { ...cfg.amazonScrape, queries: amazonTopics };
    sources.push(["Amazon (busca)", () => (deps.fetchAmazonScrape ?? fetchAmazonScrapedCandidates)(scrape, { log })]);
  }
  if (cfg.shopee) {
    // "" = Shopee's best sellers (no keyword), plus this run's topics.
    const shopee = { ...cfg.shopee, keywords: ["", ...shopeeTopics] };
    sources.push(["Shopee", () => (deps.fetchShopee ? deps.fetchShopee(shopee) : fetchShopeeCandidates(shopee, 20, log))]);
  }
  if (!sources.length) throw new Error("No marketplace configured: set the AMAZON_* (API, or AMAZON_SCRAPE=on) and/or SHOPEE_* settings.");

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
  const kindCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  if (!opts.dryRun) {
    const startedAt = await dbNow(db);
    for (const [key, id] of await upsertProducts(db, candidates)) productIds.set(key, id);
    used = await recentlyUsedProductIds(db, cfg.selection.cooldownDays);
    lowest = await lowestSeenPrices(db, [...new Set(productIds.values())], startedAt);
    for (const title of await recentDealTitles(db, 24)) {
      const kind = productKind(title);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      const family = productFamily(title);
      if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    }
  }
  const idOf = (c: Candidate) => productIds.get(`${c.marketplace}:${c.externalId}`) ?? -1;
  const fake = (c: Candidate) => cfg.selection.skipFakeDiscounts && isFakeDiscount(c.priceCents, lowest.get(idOf(c)));
  const weak = (c: Candidate) => qualityProblem(c, cfg.selection.quality) !== undefined;
  const limit = cfg.selection.postsPerRun;
  const base = {
    minDiscountPct: cfg.selection.minDiscountPct,
    exclude: (c: Candidate) => used.has(idOf(c)) || isBlocked(c.title, cfg.selection.blockedWords) || fake(c) || weak(c),
    kindOf: (c: Candidate) => productKind(c.title),
    maxPerKind: cfg.selection.maxSameKindPerDay,
    kindCounts,
  };
  // At most 3 from one search term per run, so one term (e.g. a coffee search) can't fill the batch.
  const perTopic = { of: (c: Candidate) => c.topic, max: 3 };
  // Never two of one kind in the same batch (they'd go out back to back), and never two of the
  // same kind + brand in 24 h (JBL Xtreme and JBL Extreme 4 are "the same thing").
  const perRunKind = { of: (c: Candidate) => productKind(c.title), max: cfg.selection.maxSameKindPerRun };
  const perDayFamily = {
    of: (c: Candidate) => productFamily(c.title) || undefined,
    max: Math.min(cfg.selection.maxSameKindPerDay, 1),
    counts: familyCounts,
  };
  let picks = pickCandidates(candidates, { ...base, limit, limits: [perTopic, perRunKind, perDayFamily] });
  // An AI looks at a shortlist: off-theme items go, and at most 2 per theme (mug + coffee maker + kettle = one theme).
  const shortlist = pickCandidates(candidates, { ...base, limit: Math.max(limit * 3, 30) });
  const verdicts = await nicheFit(cfg.ai, shortlist).catch(() => undefined);
  if (verdicts) {
    const theme = new Map(shortlist.map((c, i) => [c, verdicts[i]!.theme]));
    const fitting = shortlist.filter((_, i) => verdicts[i]!.ok);
    const off = shortlist.filter((_, i) => !verdicts[i]!.ok);
    if (off.length) log(`Off-theme for the channel (${off.length}): ${off.map((c) => c.title.slice(0, 40)).join(" | ")}`);
    picks = pickCandidates(fitting, {
      ...base,
      limit,
      limits: [perTopic, perRunKind, perDayFamily, { of: (c) => theme.get(c) || undefined, max: 2 }],
    });
  }
  const blocked = candidates.filter((c) => isBlocked(c.title, cfg.selection.blockedWords)).length;
  const fakes = candidates.filter(fake).length;
  const weakCount = candidates.filter(weak).length;
  log(
    `Picked ${picks.length} of ${candidates.length}` +
      (blocked ? ` (${blocked} skipped by BLOCKED_WORDS)` : "") +
      (fakes ? ` (${fakes} skipped: cheaper in the last 30 days)` : "") +
      (weakCount ? ` (${weakCount} skipped: low quality — too cheap, no-name audio, bad Shopee rating/sales)` : ""),
  );

  let aiError = "";
  // Auto-approval waits until every preview of the batch exists, so the queue
  // spreads the whole batch over the window (see spreadSlot).
  const toApprove: number[] = [];
  // Previews whose line the reviewer turned down twice: the admin is asked to write it.
  const needsAdmin: string[] = [];
  // The channel's latest lines plus this batch's: every new caption must be different from them.
  const recent = opts.dryRun ? [] : await recentCaptions(db);
  for (const c of picks) {
    try {
      const ref = randomCode(10);
      const reviewed = await writeReviewedCaption(cfg.ai, c, { ...SEARCH_CAPTION, recent });
      const caption = reviewed.needsAdmin ? { ...reviewed.caption, model: NEEDS_ADMIN } : reviewed.caption;
      recent.unshift(caption.caption);
      aiError ||= caption.error ?? "";
      const image = await decideImage(
        cfg.ai,
        cfg.images,
        { title: c.title, imageUrl: c.imageUrl, marketplace: c.marketplace },
        { generatedToday: () => (opts.dryRun ? Promise.resolve(0) : generatedImagesToday(db)), log },
        { dryRun: opts.dryRun },
      );
      if (opts.dryRun) {
        if (image.kind === "store" && image.note) log(`[image] ${image.note}`);
        log(`\n--- [dry-run] ${c.marketplace} ${c.externalId} score=${score(c).toFixed(1)} ---`);
        log(
          previewHtml(cfg, {
            id: 0, product_id: 0, ref, status: "pending", price_cents: c.priceCents,
            original_price_cents: c.originalPriceCents ?? null, discount_pct: c.discountPct, lowest_seen_cents: null,
            affiliate_url: c.productUrl, caption: caption.caption, caption_short: caption.short, hashtag: caption.hashtag ?? null,
            ai_model: caption.model, preview_chat_id: null, preview_message_id: null,
            preview_has_photo: false, scheduled_at: null, price_from_admin: false, kind: "deal", coupon: null, valid_until: null, marketplace: c.marketplace,
            external_id: c.externalId, title: c.title,
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
        shortTitle: caption.name,
        aiModel: caption.model,
      });
      let shown: PostRow;
      try {
        shown = await sendPreview(cfg, db, post, image);
      } catch (error) {
        // Nobody can approve a preview that never arrived; don't leave it pending.
        await transition(db, post.id, "pending", "failed");
        throw error;
      }
      result.previews++;
      if (reviewed.needsAdmin) needsAdmin.push(`✍️ #${post.id}: a IA não acertou a legenda (${reviewed.needsAdmin}). Responda a prévia com a sua em até ${ADMIN_CAPTION_MINUTES} min; senão sai só com nome e preço.`);
      if (shouldAutoApprove(cfg, shown)) toApprove.push(post.id);
    } catch (error) {
      result.errors.push(`${c.marketplace} ${c.externalId}: ${errorMessage(error)}`);
      log(`Failed to prepare ${c.externalId}: ${errorMessage(error)}`);
    }
  }

  for (const id of toApprove) {
    try {
      log(`Auto-approved #${id}: ${await approvePost(cfg, db, id, { auto: true })}`);
      result.autoApproved++;
    } catch (error) {
      result.errors.push(`#${id}: ${errorMessage(error)}`);
    }
  }

  if (aiError) result.errors.push(`IA falhou, usei texto padrão: ${aiError}`);

  if (!opts.dryRun) {
    const msg = [
      result.previews === 0
        ? `🤷 Nenhuma promoção nova que valha a pena nesta rodada (acima de ${cfg.selection.minDiscountPct}%, sem desconto fake). A fila continua como está.`
        : `📦 <b>Lote novo: ${result.previews} ${result.previews === 1 ? "prévia" : "prévias"}</b>` +
          (result.autoApproved ? ` · ${result.autoApproved} aprovada(s) automaticamente` : "") +
          "\nAs aprovadas saem espalhadas até a próxima busca.",
      ...needsAdmin.map((l) => escapeHtml(l)),
      ...result.errors.map((e) => `⚠️ ${escapeHtml(e)}`),
    ]
      .filter(Boolean)
      .join("\n");
    await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, msg, SEARCH_AGAIN).catch(() => {});
  }
  return result;
}
