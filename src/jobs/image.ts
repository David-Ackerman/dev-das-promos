// `node src/jobs/image.ts --post 123 [--mode force|auto]` — run by
// .github/workflows/image.yml when the admin taps 🖼️ Nova imagem (force) or
// sends a product link to the bot (auto: only white-background / text-heavy
// photos are replaced). Swaps the preview's photo for an AI scene.
import { loadConfig } from "../config.ts";
import { createNodeDb } from "../db-node.ts";
import { decideImage } from "../images.ts";
import { postImageUrl, swapPreviewPhoto } from "../preview.ts";
import { generatedImagesToday, getPost, setPostImage } from "../repo.ts";
import { sendText } from "../telegram.ts";
import type { PostRow } from "../types.ts";
import { errorMessage, escapeHtml } from "../util.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const postId = Number(arg("--post") ?? process.env.POST_ID);
const mode = (arg("--mode") ?? process.env.IMAGE_JOB_MODE ?? "force") === "auto" ? "auto" : "force";
if (!Number.isInteger(postId) || postId <= 0) throw new Error("Usage: node src/jobs/image.ts --post <id> [--mode force|auto]");

const cfg = loadConfig(process.env);
const db = createNodeDb(cfg.databaseUrl);
const tell = (html: string) => sendText(cfg.telegram.botToken, cfg.telegram.adminChatId, html).catch(() => {});
try {
  const post = await getPost(db, postId);
  if (!post) throw new Error(`Post #${postId} not found`);
  if (post.status !== "pending" && post.status !== "queued") {
    await tell(`O post #${postId} já foi publicado: a imagem não muda mais.`);
  } else {
    const decision = await decideImage(
      cfg.ai,
      cfg.images,
      { title: post.title, imageUrl: post.store_image_url ?? post.image_url, marketplace: post.marketplace },
      { generatedToday: () => generatedImagesToday(db), log: console.log },
      { force: mode === "force" },
    );
    if (decision.kind === "generated") {
      const updated: PostRow = { ...post, image_source: "generated", image_note: decision.note, image_url: postImageUrl(cfg, post.id) };
      const fileId = await swapPreviewPhoto(cfg, db, updated, decision.image);
      if (!fileId) throw new Error("Telegram didn't return the photo");
      await setPostImage(db, post.id, { url: postImageUrl(cfg, post.id), fileId, source: "generated", note: decision.note });
      console.log(`#${post.id}: new AI image (${decision.model})`);
    } else if (decision.note) {
      // Keep an AI scene the post already has; otherwise just record why the store photo stayed.
      if (post.image_source !== "generated") await setPostImage(db, post.id, null, decision.note);
      // Only bother the admin when they asked (force) or something is wrong with the photo.
      await tell(`🖼️ #${post.id}: ${escapeHtml(decision.note)}`);
      console.log(`#${post.id}: kept the photo (${decision.note})`);
    } else {
      console.log(`#${post.id}: the store photo is fine`);
    }
  }
} catch (error) {
  await tell(`⚠️ Não consegui trocar a imagem do #${postId}: ${escapeHtml(errorMessage(error))}`);
  throw error;
} finally {
  await db.close();
}
