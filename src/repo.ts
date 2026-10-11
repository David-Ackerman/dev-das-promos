import type { Db } from "./db.ts";
import type { Candidate, Channel, PostRow } from "./types.ts";
import { randomCode } from "./util.ts";

const POST_SELECT = `
  SELECT p.id, p.product_id, p.ref, p.status, p.price_cents, p.original_price_cents,
         p.discount_pct, p.lowest_seen_cents, p.affiliate_url, p.caption, p.caption_short, p.ai_model,
         p.preview_chat_id, p.preview_message_id::text AS preview_message_id, p.preview_has_photo,
         pr.marketplace, pr.title, pr.image_url, pr.product_url
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

export async function createPost(
  db: Db,
  input: {
    productId: number;
    ref: string;
    candidate: Candidate;
    affiliateUrl: string;
    lowestSeenCents?: number | null;
    caption: string;
    captionShort: string;
    aiModel: string;
  },
): Promise<PostRow> {
  const rows = await db.query<{ id: number }>(
    `INSERT INTO posts (product_id, ref, price_cents, original_price_cents, discount_pct,
                        commission_rate, affiliate_url, caption, caption_short, ai_model, lowest_seen_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
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
    ],
  );
  return (await getPost(db, (rows[0] as { id: number }).id)) as PostRow;
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
): Promise<void> {
  await db.query(
    `UPDATE posts SET caption = $2, caption_short = $3, ai_model = $4 WHERE id = $1 AND status = 'pending'`,
    [postId, caption, captionShort, aiModel],
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
  return {
    days,
    posts: posts ?? { published: 0, declined: 0, pending: 0 },
    byChannel,
    byTarget,
    byMarketplace,
    topPosts,
  };
}
