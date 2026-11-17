import { generateCaption, resolveModel, type Caption, type CaptionOptions, type ModelEntry } from "./ai.ts";
import type { Config } from "./config.ts";
import type { Candidate } from "./types.ts";
import { brl, errorMessage, truncate } from "./util.ts";

/**
 * A second AI that checks the first one's work:
 * - reviewCaption: is the call line natural, right for this product and price?
 * - writeReviewedCaption: write → review → (rewrite with the reason → review) →
 *   if still bad, the admin is asked (the post waits up to 1 h, then goes without a line).
 * - nicheFit: which found products fit the channel's audience, and their theme,
 *   so a run doesn't fill up with one theme (four coffee things) or off-topic items.
 * When no model answers, nothing is blocked: the caption passes, every product fits.
 */

/** The post waits for the admin's line (ai_model of the post). */
export const NEEDS_ADMIN = "needs-admin";
/** The admin didn't write one in time: the post goes with the name and price only. */
export const NO_CAPTION = "no-caption";
/** How long the admin has to write the line. */
export const ADMIN_CAPTION_MINUTES = 60;

const REVIEW_PROMPT = `Você revisa a chamada (a frase de cima) de um post de promoção num canal brasileiro de ofertas no Telegram/WhatsApp.
No post, a chamada aparece em MAIÚSCULAS, e embaixo dela o sistema mostra o nome do produto e o preço.

Aprove só se TODAS forem verdade:
1. Natural: soa como uma pessoa de verdade num grupo de ofertas, não robô nem propaganda. Português correto, frase completa, nada truncado.
2. Faz sentido com ESTE produto: fala do que ele é ou de quem usa, sem inventar característica, sem confundir o produto com outro.
3. Combina com o preço: não chama de luxo/top/premium algo simples e barato, nem de "lembrancinha" algo caro. Não fala de valores (o preço já aparece).
4. Não repete o nome do produto, a marca nem o modelo (vêm na linha de baixo).
5. Sem piada sem relação, trocadilho forçado, duplo sentido ou frase sem sentido.

Responda APENAS com JSON: {"ok": true} ou {"ok": false, "motivo": "o problema, em uma frase curta"}`;

const NICHE_PROMPT = `Você escolhe produtos para um canal brasileiro de promoções. O público do canal: {NICHE}.
Para cada produto numerado, responda:
- "ok": true se é algo que esse público compraria pra si ou daria de presente e combina com o canal; false se foge do tema do canal, é roupa íntima/lingerie, adulto, item de farmácia/higiene sem relação, parece produto de baixa qualidade, ou é para CRIANÇAS (brinquedo, livro infantil ou bilíngue infantil, material escolar, canetinha, item de bebê): nada infantil, nunca.
- "tema": o tema do produto em 1 ou 2 palavras (ex.: "café", "periférico gamer", "livro", "áudio", "cozinha"). Produtos diferentes do mesmo universo têm o MESMO tema (caneca, cafeteira e chaleira = "café").

Responda APENAS com JSON: {"itens": [{"n": 1, "ok": true, "tema": "..."}, ...]}`;

type ChatMessage = { content?: string | { text?: string }[] | null; reasoning?: string | null; reasoning_content?: string | null };

/** Asks the models in order for a JSON answer; the first one that gives a usable object wins. */
async function askJson(
  cfg: Config["ai"],
  system: string,
  user: string,
  opts: { perModelMs?: number; budgetMs?: number; maxTokens?: number; usable: (o: Record<string, unknown>) => boolean },
): Promise<Record<string, unknown> | undefined> {
  const entries: ModelEntry[] = cfg.models.map((m) => resolveModel(cfg, m)).filter((e) => e.apiKey);
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  for (const entry of entries) {
    const left = deadline - Date.now();
    if (left < 2_000) break;
    try {
      const res = await fetch(`${entry.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${entry.apiKey}`, "X-Title": "das-promos" },
        body: JSON.stringify({
          model: entry.model,
          temperature: 0.2,
          max_tokens: opts.maxTokens ?? 1500,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(Math.min(left, opts.perModelMs ?? 20_000)),
      });
      const body = (await res.json().catch(() => ({}))) as { choices?: { message?: ChatMessage }[] };
      if (!res.ok) continue;
      const msg = body.choices?.[0]?.message;
      const content = Array.isArray(msg?.content) ? msg.content.map((p) => p.text ?? "").join("") : (msg?.content ?? "");
      for (const text of [content, msg?.reasoning ?? "", msg?.reasoning_content ?? ""]) {
        const obj = lastJsonObject(text.replace(/<think>[\s\S]*?<\/think>/gi, ""));
        if (obj && opts.usable(obj)) return obj;
      }
    } catch (error) {
      console.warn(`review: ${entry.label}: ${errorMessage(error)}`);
    }
  }
  return undefined;
}

/** The last parseable {...} in a text (models sometimes think out loud first). */
export function lastJsonObject(text: string): Record<string, unknown> | undefined {
  for (let end = text.lastIndexOf("}"); end >= 0; end = text.lastIndexOf("}", end - 1)) {
    for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        const obj = JSON.parse(text.slice(start, end + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
      } catch {}
    }
  }
  return undefined;
}

export interface Review {
  ok: boolean;
  reason: string;
}

function priceFacts(c: Candidate): string {
  return c.originalPriceCents && c.discountPct > 0 ? `de ${brl(c.originalPriceCents)} por ${brl(c.priceCents)}` : brl(c.priceCents);
}

/** undefined = no model answered (the caption is let through). */
export async function reviewCaption(cfg: Config["ai"], c: Candidate, caption: string): Promise<Review | undefined> {
  const user = `Produto: ${c.title}\nPreço: ${priceFacts(c)}\nChamada: "${caption}"`;
  const obj = await askJson(cfg, REVIEW_PROMPT, user, { usable: (o) => typeof o.ok === "boolean", maxTokens: 800 });
  if (!obj) return undefined;
  const reason = typeof obj.motivo === "string" ? truncate(obj.motivo.trim(), 160) : "";
  return obj.ok === true ? { ok: true, reason: "" } : { ok: false, reason: reason || "não soou natural" };
}

export interface ReviewedCaption {
  caption: Caption;
  /** Both tries were turned down: why the last one was. The admin is asked. */
  needsAdmin?: string;
}

/** write → review → rewrite with the reviewer's reason → review. Templates (no model answered) aren't reviewed. */
export async function writeReviewedCaption(
  cfg: Config["ai"],
  c: Candidate,
  opts: CaptionOptions = {},
  deps: { generate?: typeof generateCaption; review?: typeof reviewCaption } = {},
): Promise<ReviewedCaption> {
  const generate = deps.generate ?? generateCaption;
  const review = deps.review ?? reviewCaption;
  const first = await generate(cfg, c, undefined, opts);
  if (first.model === "template") return { caption: first };
  const r1 = await review(cfg, c, first.caption);
  if (!r1 || r1.ok) return { caption: first };
  const second = await generate(cfg, c, first.caption, { ...opts, feedback: { text: first.caption, reason: r1.reason } });
  if (second.model === "template") return { caption: first, needsAdmin: r1.reason };
  const r2 = await review(cfg, c, second.caption);
  if (!r2 || r2.ok) return { caption: second };
  return { caption: second, needsAdmin: r2.reason };
}

export interface NicheVerdict {
  ok: boolean;
  theme: string;
}

/**
 * One request for the whole shortlist. Returns a verdict per item (same order),
 * or undefined when there's no niche set or no model answered.
 */
export async function nicheFit(cfg: Config["ai"], items: Candidate[]): Promise<NicheVerdict[] | undefined> {
  if (!cfg.niche || !items.length) return undefined;
  const list = items.map((c, i) => `${i + 1}. ${truncate(c.title, 120)} — ${brl(c.priceCents)}`).join("\n");
  const obj = await askJson(cfg, NICHE_PROMPT.replace("{NICHE}", cfg.niche), list, {
    usable: (o) => Array.isArray(o.itens),
    maxTokens: 4000,
    perModelMs: 40_000,
    budgetMs: 90_000,
  });
  if (!obj) return undefined;
  const out: NicheVerdict[] = items.map(() => ({ ok: true, theme: "" }));
  for (const raw of obj.itens as unknown[]) {
    const it = raw as { n?: unknown; ok?: unknown; tema?: unknown };
    const n = Number(it.n);
    if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
    out[n - 1] = {
      ok: it.ok !== false,
      theme: typeof it.tema === "string" ? it.tema.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "",
    };
  }
  return out;
}
