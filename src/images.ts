import { resolveModel } from "./ai.ts";
import type { AiConfig, ImageConfig } from "./config.ts";
import { bestImageUrl } from "./publishers/x.ts";
import type { UploadedImage } from "./telegram.ts";
import { errorMessage, truncate } from "./util.ts";

/**
 * Product photos for the posts.
 *
 * Store photos with a plain white background (every Amazon main photo) look
 * flat in a feed, and some Shopee photos are covered in text/banners. For
 * those, an image model puts the SAME product in a real scene where it's used
 * (kitchen, desk, gamer setup…), filling the frame. Runs in GitHub Actions
 * (collect, and the 🖼️ button's workflow): fetch only, no native image libs.
 *
 * 1. a vision model looks at the photo (free: Gemini's free tier) → white
 *    background? lots of text? which scene fits?
 * 2. if needed and IMAGE_MODEL is set: the image model edits the photo
 *    ("gemini:<model>" via Google's API, or "openrouter:<model>").
 */

export interface PhotoCheck {
  whiteBackground: boolean;
  tooMuchText: boolean;
  /** Where the product is used, in English, e.g. "modern kitchen countertop". */
  scene: string;
}

export type ImageDecision =
  | { kind: "store"; note?: string }
  | { kind: "generated"; image: UploadedImage; note: string; model: string };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 7 * 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The store photo, biggest variant first. */
export async function downloadPhoto(url: string): Promise<UploadedImage | undefined> {
  const tries = [...new Set([bestImageUrl(url), url])];
  for (const u of tries) {
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    const mime = res?.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!res?.ok || !IMAGE_TYPES.includes(mime)) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 2_000 && bytes.length <= MAX_BYTES) return { bytes, mime };
  }
  return undefined;
}

const CHECK_PROMPT = `You review the product photo of an online deal before it is posted.
Answer ONLY with JSON: {"white_background": boolean, "too_much_text": boolean, "scene": string}
- "white_background": true if the product sits on a plain white / very light solid studio background (typical marketplace photo).
- "too_much_text": true if big text, banners, badges, prices, stickers or an infographic/collage cover a noticeable part of the image (a small brand logo on the product itself does not count).
- "scene": a short English description of the realistic place where this product is typically used, e.g. "modern kitchen countertop", "home office desk", "gamer desk setup with RGB lights", "living room sofa", "bathroom sink", "city street".`;

export function parsePhotoCheck(raw: string): PhotoCheck {
  const json = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("vision model did not return JSON");
  const obj = JSON.parse(json) as Record<string, unknown>;
  const yes = (v: unknown) => v === true || v === "true";
  const scene = typeof obj.scene === "string" ? obj.scene.trim() : "";
  return {
    whiteBackground: yes(obj.white_background),
    tooMuchText: yes(obj.too_much_text),
    scene: truncate(scene.replace(/["\n]/g, " "), 120),
  };
}

/** Asks a vision model (OpenAI-compatible chat with an image) what the photo looks like. */
export async function checkPhoto(ai: AiConfig, model: string, photo: UploadedImage, title: string): Promise<PhotoCheck> {
  const entry = resolveModel(ai, model);
  if (!entry.apiKey) throw new Error(`no API key for ${model}`);
  const res = await fetch(`${entry.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${entry.apiKey}` },
    body: JSON.stringify({
      model: entry.model,
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: CHECK_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Product: ${title}` },
            { type: "image_url", image_url: { url: `data:${photo.mime};base64,${toBase64(photo.bytes)}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${body.error?.message ?? ""}`.trim());
  const content = body.choices?.[0]?.message?.content;
  return parsePhotoCheck(Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : (content ?? ""));
}

export function scenePrompt(title: string, scene: string): string {
  return [
    `Product: ${title}.`,
    "Create a photorealistic lifestyle product photo using the EXACT product from the attached image:",
    "keep its shape, colors, materials, logo and every detail identical; do not redesign, recolor or replace it.",
    `Place it naturally in this setting: ${scene || "the realistic place where this product is typically used"}.`,
    "The scene must fill the whole frame edge to edge (no white or plain studio background, no borders).",
    "The product is the clear hero: large, in focus, centered or on the rule of thirds, realistic scale.",
    "Soft natural light, shallow depth of field, high-end advertising look, square 1:1.",
    "Remove any text, banners, badges, prices, stickers or watermarks from the original photo.",
    "Do NOT add any text, letters, numbers, logos or people's faces.",
  ].join(" ");
}

interface InlineData {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

/** Google's Gemini API (generateContent with an image in and an image out). Needs GEMINI_API_KEY with billing. */
async function geminiImage(apiKey: string, model: string, photo: UploadedImage, prompt: string): Promise<UploadedImage> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: photo.mime, data: toBase64(photo.bytes) } }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "1:1" } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { inlineData?: InlineData; inline_data?: InlineData; text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error?.message ?? ""}`.trim());
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const data = parts.map((p) => p.inlineData ?? p.inline_data).find((d) => d?.data);
  if (!data?.data) {
    const why = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? parts.find((p) => p.text)?.text ?? "no image";
    throw new Error(`no image in reply (${truncate(String(why), 80)})`);
  }
  return { bytes: fromBase64(data.data), mime: data.mimeType ?? data.mime_type ?? "image/png" };
}

/** OpenRouter image models (chat completions with modalities ["image","text"]). */
async function openRouterImage(baseUrl: string, apiKey: string, model: string, photo: UploadedImage, prompt: string): Promise<UploadedImage> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "X-Title": "das-promos" },
    body: JSON.stringify({
      model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${photo.mime};base64,${toBase64(photo.bytes)}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error?.message ?? ""}`.trim());
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("no image in reply");
  return { bytes: fromBase64(m[2] as string), mime: m[1] as string };
}

/** Puts the product in its scene. `model` is "gemini:<model>" or "openrouter:<model>". */
export async function generateScene(ai: AiConfig, model: string, photo: UploadedImage, title: string, scene: string): Promise<UploadedImage> {
  const at = model.indexOf(":");
  const provider = at > 0 ? model.slice(0, at).toLowerCase() : "";
  const name = model.slice(at + 1);
  const prompt = scenePrompt(title, scene);
  try {
    if (provider === "gemini") {
      const key = ai.providers.gemini?.apiKey;
      if (!key) throw new Error("GEMINI_API_KEY is not set");
      return await geminiImage(key, name, photo, prompt);
    }
    if (provider === "openrouter") {
      const p = ai.providers.openrouter;
      if (!p?.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
      return await openRouterImage(p.baseUrl, p.apiKey, name, photo, prompt);
    }
    throw new Error('IMAGE_MODEL must start with "gemini:" or "openrouter:"');
  } catch (error) {
    throw new Error(`${model}: ${errorMessage(error)}`);
  }
}

export interface ImageDeps {
  /** AI images already made today (for IMAGE_DAILY_LIMIT). */
  generatedToday: () => Promise<number>;
  log?: (msg: string) => void;
}

/**
 * Decides the post's photo. `force` (the 🖼️ button) skips the check and
 * always makes a new scene. Never throws: on any problem the store photo stays,
 * with a note for the admin.
 */
export async function decideImage(
  ai: AiConfig,
  cfg: ImageConfig,
  product: { title: string; imageUrl?: string | null; marketplace: string },
  deps: ImageDeps,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<ImageDecision> {
  const log = deps.log ?? (() => {});
  if (!product.imageUrl) return { kind: "store" };
  // Without an image model there's nothing to do about a bad photo, so don't even look.
  if (!cfg.model) return { kind: "store" };
  const photo = await downloadPhoto(product.imageUrl);
  if (!photo) return { kind: "store", note: "não consegui baixar a foto da loja" };

  let check: PhotoCheck | undefined;
  if (cfg.checkModel) {
    check = await checkPhoto(ai, cfg.checkModel, photo, product.title).catch((error) => {
      log(`photo check failed: ${errorMessage(error)}`);
      return undefined;
    });
  }
  // Amazon's main photo is always on white (Amazon requires it), so no check needed to know.
  const white = check?.whiteBackground ?? product.marketplace === "amazon";
  const text = check?.tooMuchText ?? false;
  if (!opts.force && !white && !text) return { kind: "store" };

  const problem = opts.force ? "nova imagem" : text ? "foto da loja com muito texto" : "foto da loja com fundo branco";
  if (opts.dryRun) return { kind: "store", note: `${problem}: geraria uma cena (${check?.scene || "cena padrão"})` };
  if ((await deps.generatedToday()) >= cfg.dailyLimit) {
    return { kind: "store", note: `${problem}; limite de ${cfg.dailyLimit} imagens de IA por dia atingido` };
  }
  try {
    const image = await generateScene(ai, cfg.model, photo, product.title, check?.scene ?? "");
    return { kind: "generated", image, model: cfg.model, note: `🖼️ imagem de IA (${problem})` };
  } catch (error) {
    log(`scene generation failed: ${errorMessage(error)}`);
    return { kind: "store", note: `${problem}; a IA de imagem falhou: ${truncate(errorMessage(error), 120)}` };
  }
}
