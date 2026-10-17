// Short vertical video (1080×1920, 10 s) for Reels / TikTok / Shorts, built with
// ffmpeg from the real product photo: hook, photo with a slow zoom, price, CTA.
// Node only (GitHub Actions: src/jobs/video.ts); never imported by the Worker.
// No music on purpose: the apps favour a trending sound picked when posting.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { STORE } from "./render.ts";
import type { Marketplace } from "./types.ts";
import { brl } from "./util.ts";

export interface VideoSpec {
  hook: string;
  title: string;
  marketplace: Marketplace;
  priceCents: number;
  originalPriceCents: number | null;
  discountPct: number;
  brand: string;
  /** Local product photo; the banner is used when there's none. */
  imagePath: string;
}

const W = 1080;
const H = 1920;
const SECONDS = 10;
const FPS = 30;

/** drawtext can't draw color emoji; they'd show as boxes. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Greedy word wrap to `maxChars` per line, at most `maxLines` (… on the last). */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) {
      current = "";
      const last = lines[maxLines - 1] as string;
      lines[maxLines - 1] = `${last.replace(/[.,;:!?]?$/, "").slice(0, maxChars - 1)}…`;
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

interface TextItem {
  text: string;
  y: number;
  size: number;
  color: string;
  box?: string;
  x?: string;
}

/** One drawtext per line, read from a file (no escaping issues), centered unless x is given. */
function drawtext(dir: string, font: string, items: TextItem[]): string[] {
  return items.map((item, i) => {
    const file = join(dir, `t${i}.txt`);
    writeFileSync(file, item.text, "utf8");
    const box = item.box ? `:box=1:boxcolor=${item.box}:boxborderw=22` : "";
    return (
      `drawtext=fontfile='${font}':textfile='${file}':expansion=none:fontsize=${item.size}:fontcolor=${item.color}` +
      `:x=${item.x ?? "(w-text_w)/2"}:y=${item.y}${box}`
    );
  });
}

/**
 * Layout keeps everything inside the apps' safe area: TikTok / Reels cover the
 * bottom ~20% (caption, username) and the right edge (like / comment buttons).
 */
export function videoFilter(spec: VideoSpec, dir: string, font: string): string {
  const card = 700;
  const photo = 660;
  const cardY = 400;
  const items: TextItem[] = [];
  items.push({ text: stripEmoji(spec.brand).toUpperCase(), y: 70, size: 38, color: "0xff7a33" });
  wrapLines(stripEmoji(spec.hook), 26, 3).forEach((line, i) => items.push({ text: line, y: 140 + i * 76, size: 58, color: "white" }));
  if (spec.discountPct > 0) {
    items.push({ text: `-${spec.discountPct}%`, y: cardY + 30, size: 62, color: "white", box: "0x2b8a3e", x: String((W - card) / 2 + 30) });
  }
  const below = cardY + card + 36;
  wrapLines(stripEmoji(spec.title), 34, 2).forEach((line, i) => items.push({ text: line, y: below + i * 56, size: 44, color: "white" }));
  if (spec.originalPriceCents && spec.discountPct > 0) {
    items.push({ text: `de ${brl(spec.originalPriceCents)}`, y: below + 124, size: 40, color: "0xa9b4c2" });
  }
  items.push({ text: `por ${brl(spec.priceCents)}`, y: below + 172, size: 88, color: "0xff7a33" });
  items.push({ text: `na ${STORE[spec.marketplace]}`, y: below + 274, size: 38, color: "white" });
  items.push({ text: "LINK NA BIO", y: below + 336, size: 48, color: "0x111111", box: "0xff7a33" });
  items.push({ text: "#publi · link de afiliado", y: below + 422, size: 28, color: "0xa9b4c2" });
  return [
    `[0:v]scale=${photo * 2}:${photo * 2}:force_original_aspect_ratio=decrease,pad=${photo * 2}:${photo * 2}:(ow-iw)/2:(oh-ih)/2:color=white,` +
      `zoompan=z='min(zoom+0.0007,1.15)':d=${SECONDS * FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${photo}x${photo}:fps=${FPS}[prod]`,
    `[1:v]drawbox=x=${(W - card) / 2}:y=${cardY}:w=${card}:h=${card}:color=white:t=fill[bg]`,
    `[bg][prod]overlay=${(W - photo) / 2}:${cardY + (card - photo) / 2}:shortest=1[base]`,
    `[base]${drawtext(dir, font, items).join(",")},fade=t=in:st=0:d=0.4,format=yuv420p[v]`,
  ].join(";");
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr}`))));
  });
}

/** Renders the video to `outPath` (MP4, H.264 + silent AAC so every app accepts it). */
export async function buildVideo(spec: VideoSpec, outPath: string, dir: string, font: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-i", spec.imagePath,
    "-f", "lavfi", "-i", `color=c=0x0b1b3d:s=${W}x${H}:r=${FPS}:d=${SECONDS}`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", videoFilter(spec, dir, font),
    "-map", "[v]", "-map", "2:a",
    "-t", String(SECONDS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/** Caption to paste in Instagram / TikTok (links aren't clickable there: "link na bio"). */
export function socialCaption(spec: VideoSpec, hashtag: string | null): string {
  const price = spec.discountPct > 0 ? `${brl(spec.priceCents)} (-${spec.discountPct}%)` : brl(spec.priceCents);
  const tags = ["#publi", "#achadinhos", "#promoção", "#tech", "#setup", hashtag ? `#${hashtag}` : ""].filter(Boolean).join(" ");
  return `${spec.hook}\n\n${spec.title} por ${price} na ${STORE[spec.marketplace]} 🔥\n🔗 Link na bio\n\n${tags}`;
}
