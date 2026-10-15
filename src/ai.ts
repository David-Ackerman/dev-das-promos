import type { Config } from "./config.ts";
import { STORE } from "./render.ts";
import type { Candidate } from "./types.ts";
import { brl, errorMessage, sleep, truncate } from "./util.ts";

export interface Caption {
  caption: string; // Telegram / WhatsApp
  short: string; // X
  model: string; // "template" when AI wasn't used
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
- NÃO escreva preço, desconto, link, @menções nem hashtags (o sistema adiciona isso depois).
- No máximo 1 ou 2 emojis.
- Responda APENAS com JSON: {"texto": "...", "tweet": "..."}
  - "texto": 1 a 3 frases curtas (máx. 280 caracteres).
  - "tweet": uma frase de efeito (máx. 140 caracteres).`;

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

export function parseAiJson(raw: string): { texto: string; tweet: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON");
  const obj = JSON.parse(match[0]) as Record<string, unknown>;
  const texto = typeof obj.texto === "string" ? obj.texto : "";
  const tweet = typeof obj.tweet === "string" ? obj.tweet : texto;
  if (!texto.trim()) throw new Error('AI JSON missing "texto"');
  return { texto, tweet };
}

/** Whole budget for one caption. The Worker (🔄 button) is cut off ~30s after answering Telegram. */
const AI_BUDGET_MS = 22_000;
const RETRY_AFTER_429_MS = 1_500;

/** HTTP 429 = the model is busy right now; worth a short wait, then another model. */
class BusyError extends Error {}

async function askModel(cfg: Config["ai"], model: string, candidate: Candidate, timeoutMs: number): Promise<Caption> {
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
        { role: "user", content: facts(candidate) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg = `${model}: HTTP ${res.status} ${body.error?.message ?? ""}`.trim();
    throw res.status === 429 ? new BusyError(msg) : new Error(msg);
  }
  const parsed = parseAiJson(body.choices?.[0]?.message?.content ?? "");
  const caption = cleanAiText(parsed.texto, 300);
  const short = cleanAiText(parsed.tweet, 150);
  if (!caption) throw new Error(`${model}: AI text empty after cleanup`);
  return { caption, short: short || truncate(caption, 150), model };
}

/**
 * Tries each model in AI_MODEL in order (a busy one gets one quick retry), all
 * inside AI_BUDGET_MS. If none answers, a template line is used and `error` says why.
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
  for (const model of cfg.models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 2_000) break;
      try {
        return await askModel(cfg, model, candidate, Math.min(left, 15_000));
      } catch (error) {
        errors.push(errorMessage(error));
        if (!(error instanceof BusyError) || attempt === 2) break;
        await sleep(Math.min(RETRY_AFTER_429_MS, Math.max(0, deadline - Date.now() - 2_000)));
      }
    }
  }
  const error = errors.join(" | ") || "AI time budget exhausted";
  console.warn(`AI caption failed, using template: ${error}`);
  return { ...templateCaption(candidate, Date.now(), avoid), error };
}
