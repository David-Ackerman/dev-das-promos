import type { Config } from "./config.ts";
import { STORE } from "./render.ts";
import type { Candidate, PostRow } from "./types.ts";
import { brl, errorMessage, sleep, truncate } from "./util.ts";

export interface Caption {
  caption: string; // Telegram / WhatsApp
  short: string; // X
  model: string; // "template" when AI wasn't used
  /** Brand/product hashtag for X, without "#" (e.g. "Kindle"). */
  hashtag?: string;
  /** Why the AI wasn't used, when it was configured but failed. */
  error?: string;
}

/**
 * Works with any OpenAI-compatible chat API: OpenRouter (default), Groq,
 * Google Gemini's OpenAI endpoint, etc. Set AI_BASE_URL / AI_API_KEY / AI_MODEL.
 * Price, link and disclosure are added by our code, never by the model, so
 * the AI can't invent a wrong price.
 */
const SYSTEM_PROMPT = `Você escreve a frase de chamada de um post de promoção num canal/grupo brasileiro (Telegram e WhatsApp).
A frase fica logo acima do nome do produto, da foto e do preço.

Como a frase deve ser:
- UMA frase curta e simples (até uns 60 caracteres), direta, no jeito de quem fala com amigo.
- Fale do PRODUTO e do que ele faz por quem compra: o benefício principal, o uso, a sensação. Um exagero de brincadeira é bem-vindo ("dá mais FPS", "pisar fofo").
- Cite o produto de forma natural e curta: o modelo/marca ("Air Max", "Dunk Low") ou o tipo ("esse teclado", "essa air fryer"). Nunca o nome completo.
- NÃO faça piada que não tem a ver com o produto, nem trocadilho forçado, nem referência a programação/dev/TI/trabalho de escritório se o produto não for disso.
- NÃO use frases de vendedor: "achado", "imperdível", "corre", "aproveite", "não perca", "ideal para", "perfeito para".
- Não invente característica que não dá pra tirar do nome do produto.
- Sem preço, desconto, link, @menção ou hashtag (o sistema coloca). No máximo 1 emoji, e só se combinar.

Exemplos (produto → texto):
- Tênis Nike Air Max 90 masculino → Nike Air Max pra você pisar fofo
- Teclado mecânico gamer Redragon Kumara RGB → Esse teclado vai melhorar sua gameplay
- Placa de vídeo Radeon RX 7600 8GB RGB → Placa de vídeo com RGB dá mais FPS 😎
- Placa de vídeo Radeon RX 9060 XT → Bora dar um upgrade nessa máquina
- Tênis Nike Dunk Low feminino → Dunk Low pras meninas
- Smartwatch Huawei Band 10 → Esse faz mais do que mostrar as horas
- Air fryer Mondial 4L → Batata crocante sem gastar óleo
- Cadeira gamer ThunderX3 → Suas costas agradecem depois da ranked
- Fone Bluetooth JBL Tune 520BT → Música sem fio o dia inteiro

Responda APENAS com JSON: {"texto": "...", "tweet": "...", "tag": "..."}
- "texto": a frase (até 70 caracteres).
- "tweet": a mesma frase ou uma variação (até 100 caracteres).
- "tag": a marca ou o nome curto do produto, para virar hashtag (ex.: "Kindle", "JBL", "AirMax"), sem # e sem espaços; "" se não houver uma marca clara.`;

/** Short product name for template lines: "Fone Bluetooth JBL Tune 520BT, Preto" -> "Fone Bluetooth JBL Tune". */
export function shortProductName(title: string): string {
  const head = title.split(/\s[-–|,(/]|[,(|]/)[0] ?? title;
  const words = head.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  return words || title;
}

const TEMPLATES = [
  (n: string) => `${n} com preço bom de verdade`,
  (n: string) => `${n} pagando bem menos`,
  (n: string) => `Bora de ${n}?`,
  (n: string) => `${n} pelo menor preço que achamos`,
  (n: string) => `Olha o preço: ${n} 👀`,
  (n: string) => `${n} tá valendo a pena hoje`,
];

/** A template line; `avoid` (the current text) is skipped so 🔄 always changes something. */
export function templateCaption(
  candidate: Pick<Candidate, "title">,
  seed = Date.now(),
  avoid?: string,
): Caption {
  const name = shortProductName(candidate.title);
  const options = TEMPLATES.map((t) => t(name)).filter((t) => t !== avoid);
  const line = options[Math.abs(seed) % options.length] as string;
  return { caption: line, short: line, model: "template" };
}

/** The niche (NICHE) is left out on purpose: texts are about the product, not the audience. */
function facts(c: Candidate): string {
  return [
    `Produto: ${c.title}`,
    `Loja: ${STORE[c.marketplace]}`,
    `Preço (só contexto, não escreva): ${brl(c.priceCents)}`,
    c.discountPct ? `Desconto (só contexto, não escreva): ${c.discountPct}%` : "",
    c.rating ? `Nota dos compradores: ${c.rating}` : "",
    c.sales ? `Vendidos: ${c.sales}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const LINK_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|br|net|io|ly)(\/\S*)?/gi;
const PRICE_RE = /R\$\s?\d[\d.,]*/gi;

/**
 * At most `sentences` sentences and `max` characters: the caption is a quick
 * joke above the product, even when a model ignores "keep it short".
 */
export function shortCaption(text: string, sentences: number, max: number): string {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["”']?(\s*\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)*|[^.!?…]+$/gu) ?? [];
  const kept = parts.slice(0, sentences).join("").trim();
  return truncate(kept || text, max);
}

export function cleanAiText(text: string, max: number): string {
  return truncate(
    text
      .replace(LINK_RE, "")
      .replace(PRICE_RE, "")
      .replace(/#\w+/g, "")
      .replace(/\s+([,.!?])/g, "$1"),
    max,
  );
}

/** Generic tags reach nobody (and look like spam); only a brand/product name is worth it. */
const GENERIC_TAGS = new Set([
  "promo", "promocao", "promocoes", "oferta", "ofertas", "desconto", "descontos", "publi", "achado", "achadinho",
  "achadinhos", "barato", "shopee", "amazon", "mercadolivre", "tech", "tecnologia", "gadget", "gadgets", "produto",
]);

/** "#Kindle" / "Echo Dot" -> "Kindle" / "EchoDot"; generic or odd tags -> undefined. */
export function cleanHashtag(raw: string | undefined): string | undefined {
  const tag = (raw ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
  if (tag.length < 2 || tag.length > 24 || /^\d+$/.test(tag)) return undefined;
  const plain = tag.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return GENERIC_TAGS.has(plain) ? undefined : tag;
}

export function parseAiJson(raw: string): { texto: string; tweet: string; tag?: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON");
  const obj = JSON.parse(match[0]) as Record<string, unknown>;
  const texto = typeof obj.texto === "string" ? obj.texto : "";
  const tweet = typeof obj.tweet === "string" ? obj.tweet : texto;
  if (!texto.trim()) throw new Error('AI JSON missing "texto"');
  return { texto, tweet, tag: typeof obj.tag === "string" ? obj.tag : undefined };
}

/** Whole budget for one caption. The Worker (🔄 button) is cut off ~30s after answering Telegram. */
const AI_BUDGET_MS = 22_000;

export interface CaptionOptions {
  /** Total time for this caption, across all models and retries. */
  budgetMs?: number;
  /** Cap per request, so one slow model can't eat the whole budget. */
  perModelMs?: number;
}

/** GitHub Actions has no 30s limit: the search gives every model time and busy ones extra rounds. */
export const SEARCH_CAPTION: CaptionOptions = { budgetMs: 90_000, perModelMs: 25_000 };

/** HTTP 429 / 502 / 503 = the model is busy right now; worth trying again after the other models. */
class BusyError extends Error {}

/**
 * Reasoning models may wrap their answer in <think>…</think>, and some ignore the
 * JSON instruction and just write the line. A short plain-text reply is used as is.
 */
export function parseAiReply(raw: string): { texto: string; tweet: string; tag?: string } {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) throw new Error("empty reply");
  if (text.includes("{")) return parseAiJson(text);
  const line = text.replace(/^["“]|["”]$/g, "").trim();
  if (line.length > 400) throw new Error(`no JSON in reply: "${truncate(line, 60)}"`);
  return { texto: line, tweet: line };
}

type MessageContent = string | { type?: string; text?: string }[] | null | undefined;

function contentText(content: MessageContent): string {
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return content ?? "";
}

export interface ModelEntry {
  /** As written in AI_MODEL, e.g. "groq:openai/gpt-oss-20b". */
  label: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

/** "groq:x" -> Groq's x; "google/gemma:free" (no known prefix) -> the AI_BASE_URL provider. */
export function resolveModel(cfg: Config["ai"], entry: string): ModelEntry {
  const at = entry.indexOf(":");
  const prefix = at > 0 ? entry.slice(0, at).toLowerCase() : "";
  const provider = cfg.providers[prefix];
  if (provider) return { label: entry, model: entry.slice(at + 1), ...provider };
  return { label: entry, model: entry, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
}

interface ChatMessage {
  content?: MessageContent;
  /** Reasoning models (via OpenRouter, Groq, …) may leave the answer here and `content` empty. */
  reasoning?: string | null;
  reasoning_content?: string | null;
}

/** One chat request. Exported for the AI check job. */
export async function askModel(
  cfg: Config["ai"],
  entry: ModelEntry,
  candidate: Candidate,
  timeoutMs: number,
): Promise<Caption> {
  try {
    if (!entry.apiKey) throw new Error("no API key for this provider");
    const res = await fetch(`${entry.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${entry.apiKey}`,
        "X-Title": "das-promos",
      },
      body: JSON.stringify({
        model: entry.model,
        temperature: 0.9,
        // Room for reasoning models to think *and* answer; without it some return an empty reply.
        max_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: facts(candidate) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: { message?: ChatMessage }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = `HTTP ${res.status} ${body.error?.message ?? ""}`.trim();
      // 429 = rate limited, 502/503 = overloaded: both pass, so worth another round later.
      throw [429, 502, 503].includes(res.status) ? new BusyError(msg) : new Error(msg);
    }
    const message = body.choices?.[0]?.message;
    let parsed: { texto: string; tweet: string; tag?: string };
    try {
      parsed = parseAiReply(contentText(message?.content));
    } catch (error) {
      // Empty answer, but the JSON may sit at the end of the reasoning.
      const reasoning = message?.reasoning ?? message?.reasoning_content ?? "";
      const json = reasoning.match(/\{[^{}]*"texto"[^{}]*\}/g)?.at(-1);
      if (!json) throw error;
      parsed = parseAiJson(json);
    }
    const caption = shortCaption(cleanAiText(parsed.texto, 400), 1, 90);
    const short = shortCaption(cleanAiText(parsed.tweet, 300), 1, 110);
    // "...", "ok", a lone emoji: not a caption, let the next model try.
    if ((caption.match(/\p{L}/gu) ?? []).length < 8) throw new Error(`reply too short: "${caption}"`);
    return { caption, short: short || truncate(caption, 150), model: entry.label, hashtag: cleanHashtag(parsed.tag) };
  } catch (error) {
    // Every failure names its model, so the admin sees which ones were tried.
    const msg = `${entry.label}: ${errorMessage(error)}`;
    throw error instanceof BusyError ? new BusyError(msg) : new Error(msg);
  }
}

/**
 * Tries every model in AI_MODEL once, in order; then, while time is left,
 * gives the busy ones (HTTP 429) more rounds, waiting longer each time.
 * If nothing answers, a template line is used and `error` lists what each model said.
 */
export async function generateCaption(
  cfg: Config["ai"],
  candidate: Candidate,
  avoid?: string,
  opts: CaptionOptions = {},
): Promise<Caption> {
  const entries = cfg.models.map((m) => resolveModel(cfg, m)).filter((e) => e.apiKey);
  if (!entries.length) return templateCaption(candidate, Date.now(), avoid);
  const deadline = Date.now() + (opts.budgetMs ?? AI_BUDGET_MS);
  const perModel = opts.perModelMs ?? 12_000;
  const errors: string[] = [];
  let busy: ModelEntry[] = [];
  const attempt = async (entry: ModelEntry): Promise<Caption | undefined> => {
    const left = deadline - Date.now();
    if (left < 2_000) {
      errors.push(`${entry.label}: not tried (out of time)`);
      return undefined;
    }
    try {
      return await askModel(cfg, entry, candidate, Math.min(left, perModel));
    } catch (error) {
      errors.push(errorMessage(error));
      if (error instanceof BusyError) busy.push(entry);
      return undefined;
    }
  };

  for (const entry of entries) {
    const caption = await attempt(entry);
    if (caption) return caption;
  }
  for (const wait of [2_000, 6_000, 15_000]) {
    if (!busy.length || deadline - Date.now() < wait + 3_000) break;
    await sleep(wait);
    const round = busy;
    busy = [];
    for (const entry of round) {
      const caption = await attempt(entry);
      if (caption) return caption;
    }
  }
  const error = errors.join(" | ");
  console.warn(`AI caption failed, using template: ${error}`);
  return { ...templateCaption(candidate, Date.now(), avoid), error };
}

/** What the AI needs to know about an existing post (regenerate, healing template texts). */
export function candidateFromPost(post: Pick<PostRow, "marketplace" | "title" | "product_url" | "price_cents" | "original_price_cents" | "discount_pct">): Candidate {
  return {
    marketplace: post.marketplace,
    externalId: "",
    title: post.title,
    productUrl: post.product_url,
    priceCents: post.price_cents,
    originalPriceCents: post.original_price_cents ?? undefined,
    discountPct: post.discount_pct,
  };
}
