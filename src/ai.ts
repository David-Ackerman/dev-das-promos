import type { Config } from "./config.ts";
import { STORE } from "./render.ts";
import type { Candidate } from "./types.ts";
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
const SYSTEM_PROMPT = `Você escreve posts curtos para um grupo brasileiro de promoções.
Objetivo: fazer as pessoas rirem ou se identificarem e quererem clicar.

Regras:
- Português do Brasil, tom leve, divertido, bem brasileiro. Pode fazer uma piadinha, um trocadilho ou um comentário engraçado sobre quando/por que alguém usaria o produto.
- Use SOMENTE as informações dadas. Não invente características, avaliações, frete, estoque, prazo ou urgência ("últimas unidades", "só hoje") que não foram informados.
- No "texto" e no "tweet", NÃO escreva preço, desconto, link, @menções nem hashtags (o sistema adiciona isso depois).
- No máximo 1 ou 2 emojis.
- Se vier "Público do grupo", escreva para essas pessoas: use as referências e o jeito de falar delas.
- Responda APENAS com JSON: {"texto": "...", "tweet": "...", "tag": "..."}
  - "texto": 1 a 3 frases curtas (máx. 280 caracteres).
  - "tweet": uma frase de efeito (máx. 140 caracteres).
  - "tag": a marca ou o nome curto do produto, para virar hashtag (ex.: "Kindle", "JBL", "Xiaomi"), sem # e sem espaços; "" se não houver uma marca clara.`;

const TEMPLATES = [
  "Seu carrinho tava pedindo isso e a gente ouviu 🛒",
  "Promoção boa assim não espera o salário cair 😅",
  "Aquele achado que você vai fingir que precisava há anos 👀",
  "Se é pra gastar, que seja pagando menos 💸",
  "Achamos antes de você. De nada 😎",
  "Spoiler: seu eu do futuro agradece essa compra ✨",
];

/** A template line; `avoid` (the current text) is skipped so 🔄 always changes something. */
export function templateCaption(
  candidate: Pick<Candidate, "title">,
  seed = Date.now(),
  avoid?: string,
): Caption {
  const options = TEMPLATES.filter((t) => t !== avoid);
  const line = options[Math.abs(seed) % options.length] as string;
  return { caption: line, short: line, model: "template" };
}

function facts(c: Candidate, niche?: string): string {
  return [
    niche ? `Público do grupo: ${niche}` : "",
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
/** Per-model wait cap, so one slow model can't eat the whole budget. */
const PER_MODEL_TIMEOUT_MS = 12_000;
const BUSY_RETRY_WAIT_MS = 1_000;

/** HTTP 429 = the model is busy right now; worth trying again after the other models. */
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

async function askModel(cfg: Config["ai"], model: string, candidate: Candidate, timeoutMs: number): Promise<Caption> {
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
        "X-Title": "das-promos",
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: facts(candidate, cfg.niche) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: MessageContent } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = `HTTP ${res.status} ${body.error?.message ?? ""}`.trim();
      throw res.status === 429 ? new BusyError(msg) : new Error(msg);
    }
    const parsed = parseAiReply(contentText(body.choices?.[0]?.message?.content));
    const caption = cleanAiText(parsed.texto, 300);
    const short = cleanAiText(parsed.tweet, 150);
    if (!caption) throw new Error("AI text empty after cleanup");
    return { caption, short: short || truncate(caption, 150), model, hashtag: cleanHashtag(parsed.tag) };
  } catch (error) {
    // Every failure names its model, so the admin sees which ones were tried.
    const msg = `${model}: ${errorMessage(error)}`;
    throw error instanceof BusyError ? new BusyError(msg) : new Error(msg);
  }
}

/**
 * Tries every model in AI_MODEL once, in order; then, if time is left, gives the
 * ones that were busy (HTTP 429) one more go. All inside `budgetMs`. If nothing
 * answers, a template line is used and `error` lists what each model said.
 */
export async function generateCaption(
  cfg: Config["ai"],
  candidate: Candidate,
  avoid?: string,
  budgetMs = AI_BUDGET_MS,
): Promise<Caption> {
  if (!cfg.apiKey || !cfg.models.length) return templateCaption(candidate, Date.now(), avoid);
  const deadline = Date.now() + budgetMs;
  const errors: string[] = [];
  const busy: string[] = [];
  const attempt = async (model: string): Promise<Caption | undefined> => {
    const left = deadline - Date.now();
    if (left < 2_000) {
      errors.push(`${model}: not tried (out of time)`);
      return undefined;
    }
    try {
      return await askModel(cfg, model, candidate, Math.min(left, PER_MODEL_TIMEOUT_MS));
    } catch (error) {
      errors.push(errorMessage(error));
      if (error instanceof BusyError) busy.push(model);
      return undefined;
    }
  };

  for (const model of cfg.models) {
    const caption = await attempt(model);
    if (caption) return caption;
  }
  if (busy.length && deadline - Date.now() > BUSY_RETRY_WAIT_MS + 2_000) {
    await sleep(BUSY_RETRY_WAIT_MS);
    for (const model of busy.splice(0)) {
      const caption = await attempt(model);
      if (caption) return caption;
    }
  }
  const error = errors.join(" | ");
  console.warn(`AI caption failed, using template: ${error}`);
  return { ...templateCaption(candidate, Date.now(), avoid), error };
}
