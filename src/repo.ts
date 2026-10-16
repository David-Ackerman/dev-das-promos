import type { Db } from "./db.ts";
import type { SiteDeal } from "./site.ts";
import type { Candidate, Channel, PostRow } from "./types.ts";
import { randomCode } from "./util.ts";

const POST_SELECT = `
  SELECT p.id, p.product_id, p.ref, p.status, p.price_cents, p.original_price_cents,
         p.discount_pct, p.lowest_seen_cents, p.affiliate_url, p.caption, p.caption_short, p.hashtag, p.ai_model,
         p.preview_chat_id, p.preview_message_id::text AS preview_message_id, p.preview_has_photo,
         to_char(p.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS scheduled_at,
         p.price_from_admin, pr.marketplace, pr.external_id, pr.title, pr.image_url, pr.product_url
  FROM posts p JOIN products pr ON pr.id = p.product_id`;

export async function upsertProduct(db: Db, c: Candidate): Promise<number> {
  const rows = await db.query<{ id: number }>(
    `INSERT INTO products (marketplace, external_id, title, image_url, product_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (marketplace, external_id) DO UPDATE
       SET title = EXCLUDED.title, image_url = EXCLUDED.image_url,
           product_url = EXCLUDED.product_url, updated_at = now()
     RETURNING id`,
    [c.marketplace, c.externalId, c.title, c.imageUrl ?? null, c.productUrl],
  );
  const productId = (rows[0] as { id: number }).id;
  await db.query(
    `INSERT INTO price_snapshots (product_id, price_cents, original_price_cents) VALUES ($1, $2, $3)`,
    [productId, c.priceCents, c.originalPriceCents ?? null],
  );
  return productId;
}

/**
 * Products that already had a post (approved, pending, declined…) inside the cooldown window.
 * Posts whose preview never reached the admin don't count, so the product can come back.
 */
export async function recentlyUsedProductIds(db: Db, cooldownDays: number): Promise<Set<number>> {
  const rows = await db.query<{ product_id: number }>(
    `SELECT DISTINCT product_id FROM posts
     WHERE created_at > now() - make_interval(days => $1::int) AND preview_message_id IS NOT NULL`,
    [cooldownDays],
  );
  return new Set(rows.map((r) => r.product_id));
}

/** The database clock, used to tell this run's price snapshots from older ones. */
export async function dbNow(db: Db): Promise<string> {
  const rows = await db.query<{ now: string }>(`SELECT now()::text AS now`);
  return (rows[0] as { now: string }).now;
}

/** Lowest price seen for a product in the `days` before `before`, or null without history. */
export async function lowestSeenPrice(db: Db, productId: number, before: string, days = 30): Promise<number | null> {
  const rows = await db.query<{ lowest: number | null }>(
    `SELECT min(price_cents)::int AS lowest FROM price_snapshots
     WHERE product_id = $1 AND captured_at < $2::timestamptz
       AND captured_at > $2::timestamptz - make_interval(days => $3::int)`,
    [productId, before, days],
  );
  return rows[0]?.lowest ?? null;
}

/** Lowest price per product in the `days` before `before` (one query for a whole run). */
export async function lowestSeenPrices(
  db: Db,
  productIds: number[],
  before: string,
  days = 30,
): Promise<Map<number, number>> {
  if (!productIds.length) return new Map();
  const rows = await db.query<{ product_id: number; lowest: number }>(
    `SELECT product_id, min(price_cents)::int AS lowest FROM price_snapshots
     WHERE product_id = ANY($1::int[]) AND captured_at < $2::timestamptz
       AND captured_at > $2::timestamptz - make_interval(days => $3::int)
     GROUP BY product_id`,
    [productIds, before, days],
  );
  return new Map(rows.map((r) => [r.product_id, r.lowest]));
}

export async function createPost(
  db: Db,
  input: {
    productId: number;
    ref: string;
    candidate: Candidate;
    affiliateUrl: string;
    lowestSeenCents?: number | null;
    hashtag?: string | null;
    priceFromAdmin?: boolean;
    caption: string;
    captionShort: string;
    aiModel: string;
  },
): Promise<PostRow> {
  const rows = await db.query<{ id: number }>(
    `INSERT INTO posts (product_id, ref, price_cents, original_price_cents, discount_pct,
                        commission_rate, affiliate_url, caption, caption_short, ai_model, lowest_seen_cents, hashtag,
                        price_from_admin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      input.productId,
      input.ref,
      input.candidate.priceCents,
      input.candidate.originalPriceCents ?? null,
      input.candidate.discountPct,
      input.candidate.commissionRate ?? null,
      input.affiliateUrl,
      input.caption,
      input.captionShort,
      input.aiModel,
      input.lowestSeenCents ?? null,
      input.hashtag ?? null,
      input.priceFromAdmin ?? false,
    ],
  );
  return (await getPost(db, (rows[0] as { id: number }).id)) as PostRow;
}

/** A re-checked price: the post shows it from now on, and it joins the price history. */
export async function updatePostPrice(
  db: Db,
  post: { id: number; product_id: number },
  priceCents: number,
  originalPriceCents: number | null,
  discountPct: number,
): Promise<void> {
  await db.query(`UPDATE posts SET price_cents = $2, original_price_cents = $3, discount_pct = $4 WHERE id = $1`, [
    post.id,
    priceCents,
    originalPriceCents,
    discountPct,
  ]);
  await db.query(`INSERT INTO price_snapshots (product_id, price_cents, original_price_cents) VALUES ($1, $2, $3)`, [
    post.product_id,
    priceCents,
    originalPriceCents,
  ]);
}

export async function getPost(db: Db, id: number): Promise<PostRow | undefined> {
  const rows = await db.query<PostRow>(`${POST_SELECT} WHERE p.id = $1`, [id]);
  return rows[0];
}

export async function findPostByPreview(
  db: Db,
  chatId: string,
  messageId: number,
): Promise<PostRow | undefined> {
  const rows = await db.query<PostRow>(
    `${POST_SELECT} WHERE p.preview_chat_id = $1 AND p.preview_message_id = $2 ORDER BY p.id DESC LIMIT 1`,
    [chatId, messageId],
  );
  return rows[0];
}

export async function setPreview(
  db: Db,
  postId: number,
  chatId: string,
  messageId: number,
  hasPhoto: boolean,
): Promise<void> {
  await db.query(
    `UPDATE posts SET preview_chat_id = $2, preview_message_id = $3, preview_has_photo = $4 WHERE id = $1`,
    [postId, chatId, messageId, hasPhoto],
  );
}

export async function updateCaption(
  db: Db,
  postId: number,
  caption: string,
  captionShort: string,
  aiModel: string,
  hashtag?: string,
): Promise<void> {
  // A new hashtag replaces the old one; no hashtag (template, typed text) keeps it.
  await db.query(
    `UPDATE posts SET caption = $2, caption_short = $3, ai_model = $4, hashtag = COALESCE($5::text, hashtag)
     WHERE id = $1 AND status = 'pending'`,
    [postId, caption, captionShort, aiModel, hashtag ?? null],
  );
}

/**
 * Atomically moves a post from one status to another. Returns false if it
 * wasn't in `from` anymore (e.g. the Approve button was tapped twice).
 */
export async function transition(db: Db, postId: number, from: string, to: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE posts SET status = $3,
       decided_at = CASE WHEN $2 = 'pending' OR $3 = 'publishing' THEN now() ELSE decided_at END,
       published_at = CASE WHEN $3 IN ('published', 'partial') THEN now() ELSE published_at END
     WHERE id = $1 AND status = $2 RETURNING id`,
    [postId, from, to],
  );
  return rows.length > 0;
}

export async function expireStalePending(db: Db, ttlHours: number): Promise<PostRow[]> {
  const ids = await db.query<{ id: number }>(
    `UPDATE posts SET status = 'expired', decided_at = now()
     WHERE status = 'pending' AND created_at < now() - make_interval(hours => $1::int)
     RETURNING id`,
    [ttlHours],
  );
  const out: PostRow[] = [];
  for (const { id } of ids) {
    const post = await getPost(db, id);
    if (post) out.push(post);
  }
  return out;
}

/**
 * Posts left in "publishing" (the Worker was cut off mid-send) become "failed",
 * so the admin gets the retry button instead of a preview stuck forever.
 */
export async function failStuckPublishing(db: Db, minutes: number): Promise<PostRow[]> {
  const ids = await db.query<{ id: number }>(
    `UPDATE posts SET status = 'failed'
     WHERE status = 'publishing' AND decided_at < now() - make_interval(mins => $1::int)
     RETURNING id`,
    [minutes],
  );
  const out: PostRow[] = [];
  for (const { id } of ids) {
    const post = await getPost(db, id);
    if (post) out.push(post);
  }
  return out;
}

export async function listPending(db: Db): Promise<PostRow[]> {
  return db.query<PostRow>(`${POST_SELECT} WHERE p.status = 'pending' ORDER BY p.id`);
}

/** Published deals from the last `days` that haven't been marked as ended yet. */
export async function recentlyPublished(db: Db, days: number, limit: number): Promise<PostRow[]> {
  return db.query<PostRow>(
    `${POST_SELECT} WHERE p.status IN ('published', 'partial') AND p.deal_ended_at IS NULL
       AND p.published_at > now() - make_interval(days => $1::int)
     ORDER BY p.published_at DESC LIMIT $2`,
    [days, limit],
  );
}

/** Marks a deal as over; false if someone already did. */
export async function markDealEnded(db: Db, postId: number, note: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE posts SET deal_ended_at = now(), deal_note = $2 WHERE id = $1 AND deal_ended_at IS NULL RETURNING id`,
    [postId, note],
  );
  return rows.length > 0;
}

/** Telegram messages a post was delivered as (group chat id + message id). */
export async function sentTelegramMessages(db: Db, postId: number): Promise<{ target: string; message_id: string }[]> {
  return db.query<{ target: string; message_id: string }>(
    `SELECT DISTINCT target, external_id AS message_id FROM publications
     WHERE post_id = $1 AND channel = 'telegram' AND status = 'sent' AND external_id IS NOT NULL`,
    [postId],
  );
}

/** Live deals for the public page, each with its "web" link (created on first view). */
export async function siteDeals(db: Db, days: number, limit: number): Promise<SiteDeal[]> {
  const rows = await db.query<Omit<SiteDeal, "code"> & { code: string | null }>(
    `SELECT p.id, pr.title, pr.marketplace, pr.image_url, p.price_cents, p.original_price_cents, p.discount_pct, p.caption,
            to_char(p.published_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') AS published, l.code
     FROM posts p JOIN products pr ON pr.id = p.product_id
     LEFT JOIN links l ON l.post_id = p.id AND l.channel = 'web' AND l.target = ''
     WHERE p.status IN ('published', 'partial') AND p.deal_ended_at IS NULL
       AND p.published_at > now() - make_interval(days => $1::int)
     ORDER BY p.published_at DESC LIMIT $2`,
    [days, limit],
  );
  const out: SiteDeal[] = [];
  for (const r of rows) out.push({ ...r, code: r.code ?? (await getOrCreateLink(db, r.id, "web")) });
  return out;
}

/** Live deals of the last `days`, most clicked first (discount breaks ties). */
export async function topDealsForRoundup(db: Db, days: number, limit: number): Promise<number[]> {
  const rows = await db.query<{ id: number }>(
    `SELECT p.id FROM posts p
     LEFT JOIN links l ON l.post_id = p.id
     LEFT JOIN clicks c ON c.code = l.code AND NOT c.is_bot
     WHERE p.status IN ('published', 'partial') AND p.deal_ended_at IS NULL
       AND p.published_at > now() - make_interval(days => $1::int)
     GROUP BY p.id, p.discount_pct, p.published_at
     ORDER BY count(c.id) DESC, p.discount_pct DESC, p.published_at DESC
     LIMIT $2`,
    [days, limit],
  );
  return rows.map((r) => r.id);
}

/** Posts in the order of `ids`. */
export async function getPostsByIds(db: Db, ids: number[]): Promise<PostRow[]> {
  if (!ids.length) return [];
  const rows = await db.query<PostRow>(`${POST_SELECT} WHERE p.id = ANY($1::int[])`, [ids]);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((id) => byId.get(id)).filter((p): p is PostRow => Boolean(p));
}

export interface RoundupRow {
  id: number;
  post_ids: number[];
  status: string;
  preview_chat_id: string | null;
  preview_message_id: string | null;
}

export async function createRoundup(db: Db, postIds: number[]): Promise<number> {
  const rows = await db.query<{ id: number }>(`INSERT INTO roundups (post_ids) VALUES ($1::int[]) RETURNING id`, [postIds]);
  return (rows[0] as { id: number }).id;
}

export async function getRoundup(db: Db, id: number): Promise<RoundupRow | undefined> {
  const rows = await db.query<RoundupRow>(
    `SELECT id, post_ids, status, preview_chat_id, preview_message_id::text AS preview_message_id FROM roundups WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row && { ...row, post_ids: row.post_ids.map(Number) };
}

export async function setRoundupPreview(db: Db, id: number, chatId: string, messageId: number): Promise<void> {
  await db.query(`UPDATE roundups SET preview_chat_id = $2, preview_message_id = $3 WHERE id = $1`, [id, chatId, messageId]);
}

/** Same idea as transition() for posts: only one caller moves it out of `from`. */
export async function transitionRoundup(db: Db, id: number, from: string, to: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE roundups SET status = $3, sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1 AND status = $2 RETURNING id`,
    [id, from, to],
  );
  return rows.length > 0;
}

/** Pending previews from the last 12h whose text is still the stock template. */
export async function pendingTemplatePosts(db: Db, limit: number): Promise<PostRow[]> {
  return db.query<PostRow>(
    `${POST_SELECT} WHERE p.status = 'pending' AND p.ai_model = 'template'
       AND p.created_at > now() - interval '12 hours'
     ORDER BY p.id DESC LIMIT $1`,
    [limit],
  );
}

export async function listQueued(db: Db): Promise<PostRow[]> {
  return db.query<PostRow>(`${POST_SELECT} WHERE p.status = 'queued' ORDER BY p.scheduled_at NULLS LAST, p.id`);
}

/** The last post that went out or is waiting to: the next one is spaced from it. */
export async function queueTail(db: Db): Promise<Date | null> {
  const rows = await db.query<{ last: string | null }>(
    `SELECT to_char(greatest(max(scheduled_at) FILTER (WHERE status = 'queued'), max(published_at))
                    AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
     FROM posts`,
  );
  return rows[0]?.last ? new Date(rows[0].last) : null;
}

export async function setSchedule(db: Db, postId: number, at: Date | null): Promise<void> {
  await db.query(`UPDATE posts SET scheduled_at = $2::timestamptz WHERE id = $1`, [postId, at?.toISOString() ?? null]);
}

/** Queued posts whose time has come, oldest first. */
export async function dueQueued(db: Db, limit: number): Promise<number[]> {
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM posts WHERE status = 'queued' AND scheduled_at <= now() ORDER BY scheduled_at, id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

export async function getOrCreateLink(
  db: Db,
  postId: number,
  channel: Channel,
  target = "",
): Promise<string> {
  const existing = await db.query<{ code: string }>(
    `SELECT code FROM links WHERE post_id = $1 AND channel = $2 AND target = $3`,
    [postId, channel, target],
  );
  if (existing[0]) return existing[0].code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(7);
    const rows = await db.query<{ code: string }>(
      `INSERT INTO links (code, post_id, channel, target) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING code`,
      [code, postId, channel, target],
    );
    if (rows[0]) return rows[0].code;
    const again = await db.query<{ code: string }>(
      `SELECT code FROM links WHERE post_id = $1 AND channel = $2 AND target = $3`,
      [postId, channel, target],
    );
    if (again[0]) return again[0].code;
  }
  throw new Error("Could not allocate a link code");
}

export interface LinkTarget {
  code: string;
  channel: Channel;
  post_id: number;
  affiliate_url: string;
}

export async function resolveLink(db: Db, code: string): Promise<LinkTarget | undefined> {
  const rows = await db.query<LinkTarget>(
    `SELECT l.code, l.channel, l.post_id, p.affiliate_url
     FROM links l JOIN posts p ON p.id = l.post_id WHERE l.code = $1`,
    [code],
  );
  return rows[0];
}

export async function recordClick(
  db: Db,
  click: { code: string; isBot: boolean; country?: string; userAgent?: string; referer?: string; ipHash?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO clicks (code, is_bot, country, user_agent, referer, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      click.code,
      click.isBot,
      click.country ?? null,
      click.userAgent?.slice(0, 300) ?? null,
      click.referer?.slice(0, 300) ?? null,
      click.ipHash ?? null,
    ],
  );
}

export async function recordPublication(
  db: Db,
  p: { postId: number; channel: Channel; target: string; status: "sent" | "failed" | "manual"; externalId?: string; error?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO publications (post_id, channel, target, status, external_id, error) VALUES ($1, $2, $3, $4, $5, $6)`,
    [p.postId, p.channel, p.target, p.status, p.externalId ?? null, p.error?.slice(0, 500) ?? null],
  );
}

/** "channel:target" of every delivery that already worked, so a retry never sends twice. */
export async function deliveredTargets(db: Db, postId: number): Promise<Set<string>> {
  const rows = await db.query<{ channel: string; target: string }>(
    `SELECT DISTINCT channel, target FROM publications WHERE post_id = $1 AND status IN ('sent', 'manual')`,
    [postId],
  );
  return new Set(rows.map((r) => `${r.channel}:${r.target}`));
}

export interface Stats {
  days: number;
  posts: { published: number; declined: number; pending: number };
  byChannel: { channel: string; clicks: number; unique: number }[];
  byTarget: { channel: string; target: string; clicks: number; unique: number }[];
  byMarketplace: { marketplace: string; clicks: number; posts: number }[];
  topPosts: { id: number; title: string; marketplace: string; discount_pct: number; clicks: number }[];
  /** Hours (Brasília) with the most human clicks: a guide for POSTING_HOURS. */
  bestHours: { hour: number; clicks: number }[];
}

export async function getStats(db: Db, days: number): Promise<Stats> {
  const since = `now() - make_interval(days => $1::int)`;
  const [posts] = await db.query<Stats["posts"]>(
    `SELECT count(*) FILTER (WHERE status IN ('published','partial'))::int AS published,
            count(*) FILTER (WHERE status = 'declined')::int AS declined,
            count(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM posts WHERE created_at > ${since}`,
    [days],
  );
  const byChannel = await db.query<Stats["byChannel"][number]>(
    `SELECT l.channel, count(*)::int AS clicks, count(DISTINCT c.ip_hash)::int AS unique
     FROM clicks c JOIN links l ON l.code = c.code
     WHERE NOT c.is_bot AND c.clicked_at > ${since}
     GROUP BY l.channel ORDER BY clicks DESC`,
    [days],
  );
  const byTarget = await db.query<Stats["byTarget"][number]>(
    `SELECT l.channel, l.target, count(*)::int AS clicks, count(DISTINCT c.ip_hash)::int AS unique
     FROM clicks c JOIN links l ON l.code = c.code
     WHERE NOT c.is_bot AND l.target <> '' AND c.clicked_at > ${since}
     GROUP BY l.channel, l.target ORDER BY clicks DESC LIMIT 10`,
    [days],
  );
  const byMarketplace = await db.query<Stats["byMarketplace"][number]>(
    `SELECT pr.marketplace, count(c.id)::int AS clicks, count(DISTINCT p.id)::int AS posts
     FROM posts p JOIN products pr ON pr.id = p.product_id
     LEFT JOIN links l ON l.post_id = p.id
     LEFT JOIN clicks c ON c.code = l.code AND NOT c.is_bot
     WHERE p.status IN ('published','partial') AND p.published_at > ${since}
     GROUP BY pr.marketplace ORDER BY clicks DESC`,
    [days],
  );
  const topPosts = await db.query<Stats["topPosts"][number]>(
    `SELECT p.id, pr.title, pr.marketplace, p.discount_pct, count(c.id)::int AS clicks
     FROM posts p JOIN products pr ON pr.id = p.product_id
     JOIN links l ON l.post_id = p.id
     JOIN clicks c ON c.code = l.code AND NOT c.is_bot
     WHERE c.clicked_at > ${since}
     GROUP BY p.id, pr.title, pr.marketplace, p.discount_pct
     ORDER BY clicks DESC LIMIT 10`,
    [days],
  );
  const bestHours = await db.query<Stats["bestHours"][number]>(
    `SELECT extract(hour FROM c.clicked_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour, count(*)::int AS clicks
     FROM clicks c WHERE NOT c.is_bot AND c.clicked_at > ${since}
     GROUP BY 1 ORDER BY clicks DESC, hour LIMIT 3`,
    [days],
  );
  return {
    days,
    bestHours,
    posts: posts ?? { published: 0, declined: 0, pending: 0 },
    byChannel,
    byTarget,
    byMarketplace,
    topPosts,
  };
}
