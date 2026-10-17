// `node src/jobs/video.ts --post 123` — run by .github/workflows/video.yml when
// the admin taps 🎬 on a published deal (or sends /video 123). Builds the short
// vertical video and sends it to the admin chat with a caption ready to paste.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { createNodeDb } from "../db-node.ts";
import { bestImageUrl } from "../publishers/x.ts";
import { getPost } from "../repo.ts";
import { sendText, sendVideoFile } from "../telegram.ts";
import { buildVideo, socialCaption, type VideoSpec } from "../video.ts";
import { errorMessage, escapeHtml } from "../util.ts";

const i = process.argv.indexOf("--post");
const postId = Number(i >= 0 ? process.argv[i + 1] : process.env.POST_ID);
if (!Number.isInteger(postId) || postId <= 0) throw new Error("Usage: node src/jobs/video.ts --post <id>");

const FONT = process.env.VIDEO_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const BANNER = fileURLToPath(new URL("../../public/og.jpg", import.meta.url));

/** The product photo (largest variant), or the brand image when the store gives none. */
async function productImage(url: string | null, dir: string): Promise<string> {
  for (const candidate of url ? [bestImageUrl(url), url] : []) {
    const res = await fetch(candidate, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    const type = res?.headers.get("content-type") ?? "";
    if (!res?.ok || !type.startsWith("image/")) continue;
    const file = join(dir, `product.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
  return BANNER;
}

const cfg = loadConfig(process.env);
const db = createNodeDb(cfg.databaseUrl);
const dir = mkdtempSync(join(tmpdir(), "video-"));
try {
  const post = await getPost(db, postId);
  if (!post) throw new Error(`Post #${postId} not found`);
  const spec: VideoSpec = {
    hook: post.caption,
    title: post.title,
    marketplace: post.marketplace,
    priceCents: post.price_cents,
    originalPriceCents: post.original_price_cents,
    discountPct: post.discount_pct,
    brand: cfg.site.name,
    imagePath: await productImage(post.image_url, dir),
  };
  const out = join(dir, `oferta-${post.id}.mp4`);
  await buildVideo(spec, out, dir, FONT);
  const caption =
    `🎬 <b>Vídeo do post #${post.id}</b> para Reels / TikTok / Shorts\n` +
    "Antes de postar: escolha um som em alta no app e marque como conteúdo pago/parceria se aparecer a opção. " +
    "Bio: o link do site com <code>?src=ig</code> / <code>?src=tt</code>.\n\nLegenda pronta 👇";
  await sendVideoFile(cfg.telegram.botToken, cfg.telegram.adminChatId, readFileSync(out), `oferta-${post.id}.mp4`, caption);
  await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, `<pre>${escapeHtml(socialCaption(spec, post.hashtag))}</pre>`);
  console.log(`video for #${post.id} sent`);
} catch (error) {
  await sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, `⚠️ Não consegui gerar o vídeo do #${postId}: ${escapeHtml(errorMessage(error))}`).catch(() => {});
  throw error;
} finally {
  rmSync(dir, { recursive: true, force: true });
  await db.close();
}
