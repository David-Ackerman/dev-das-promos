import type { Config } from "./config.ts";
import { renderInput } from "./preview.ts";
import { shareUrl } from "./publishers/whatsapp.ts";
import { renderWhatsApp, renderX } from "./render.ts";
import type { PostRow } from "./types.ts";

/** Links that open an app with the post already written; the admin just sends it. */
export function whatsappShareUrl(cfg: Config, post: PostRow, link: string): string {
  return shareUrl(renderWhatsApp(renderInput(cfg, post, link)));
}

/** The X post with our tracked link (free when you post it yourself). */
export function xShareText(cfg: Config, post: PostRow, link: string): string {
  return renderX(renderInput(cfg, post, link), link);
}

export function xShareUrl(cfg: Config, post: PostRow, link: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(xShareText(cfg, post, link))}`;
}
