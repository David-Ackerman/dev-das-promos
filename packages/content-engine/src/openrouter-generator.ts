import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { formatCents } from "./format.js";
import { type ContentLimits, DEFAULT_CONTENT_LIMITS } from "./limits.js";
import { TemplateContentGenerator } from "./template-generator.js";
import type { ContentGenerator, DealContentInput, GeneratedDealContent } from "./types.js";

export interface OpenRouterCredentials {
  apiKey: string;
  /**
   * OpenRouter model slug, e.g. "z-ai/glm-5.2:free". Intentionally has no
   * hardcoded default anywhere in this codebase -- OpenRouter's free-model
   * catalog rotates over time (models are added/retired every few months),
   * so a baked-in default would silently go stale. Pick a current free
   * model from https://openrouter.ai/models?max_price=0 and set it via
   * OPENROUTER_MODEL (see .env.example / docs/providers.md).
   */
  model: string;
}

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterChoice {
  message?: { content?: string };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
}

/**
 * Everything the model is allowed to know, restated as plain text so the
 * prompt can't be confused with instructions. Deliberately the same
 * fields DealContentInput already carries -- nothing enriched, nothing
 * looked up, matching the "templates never invent facts" rule the
 * deterministic templates already follow (see templates/*.ts).
 */
function buildFactSheet(input: DealContentInput): string {
  const lines = [
    `Product: ${input.productName}`,
    input.brand ? `Brand: ${input.brand}` : undefined,
    `Marketplace: ${input.marketplace}`,
    input.sellerName ? `Seller: ${input.sellerName}` : undefined,
    `Current price: ${formatCents(input.effectivePriceCents, input.currency)}`,
    input.originalPriceCents
      ? `Original/list price: ${formatCents(input.originalPriceCents, input.currency)}`
      : undefined,
    input.baselinePriceCents && input.baselineLabel
      ? `Historical baseline (${input.baselineLabel}): ${formatCents(input.baselinePriceCents, input.currency)}`
      : undefined,
    `Real discount vs. historical baseline: ${input.realDiscountPercentage.toFixed(0)}%`,
    `Deal score: ${input.dealScore.toFixed(0)}/100 (${input.scoreLabel})`,
    input.signals.length ? `Signals: ${input.signals.join("; ")}` : undefined,
    input.reasoning ? `Reasoning: ${input.reasoning}` : undefined,
    `Link: ${input.goUrl}`,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

const SYSTEM_PROMPT = `You write short, punchy social/web copy for real product deals for a Brazilian Portuguese audience (write in pt-BR).

Rules, no exceptions:
- Use ONLY the facts given to you below. Never invent a price, a stock level, a seller claim, an urgency claim, or any detail not explicitly present in the facts.
- Do not include a disclosure/ad disclaimer yourself -- it is appended separately after your output.
- Do not include the link yourself for the "x" and "telegram" fields unless it's the exact link given -- it may be appended separately.
- Respond with ONLY a single JSON object, no markdown fences, no commentary, with exactly these three string keys: "telegram", "x", "webSummary".
- "telegram": a few sentences, can include an emoji or two, engaging but factual.
- "x": very short (under 200 characters), punchy, hook-driven.
- "webSummary": a couple of sentences suitable for a product page, plain and informative.`;

/**
 * AI-backed ContentGenerator using OpenRouter (a single API that proxies
 * many models, including several free ones -- see OPENROUTER_MODEL's doc
 * comment on OpenRouterCredentials). This is one of two ContentGenerator
 * implementations; TemplateContentGenerator (deterministic, free, no
 * network call) remains the default and the fallback used here whenever
 * a call fails, so a flaky/exhausted AI provider never blocks the
 * publication pipeline -- see createOpenRouterContentGenerator below and
 * apps/api/src/services/content-generation.ts for the daily-quota gate
 * that decides whether to even attempt an AI call.
 */
export class OpenRouterContentGenerator implements ContentGenerator {
  constructor(
    private readonly credentials: OpenRouterCredentials,
    private readonly limits: ContentLimits = DEFAULT_CONTENT_LIMITS,
  ) {}

  async generateDealContent(input: DealContentInput): Promise<GeneratedDealContent> {
    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.credentials.apiKey}`,
        "X-Title": "das-promos",
      },
      body: JSON.stringify({
        model: this.credentials.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildFactSheet(input) },
        ],
        temperature: 0.7,
      }),
    });

    const body = (await response.json().catch(() => undefined)) as OpenRouterResponse | undefined;

    if (!response.ok) {
      throw new Error(
        `OpenRouter request failed: HTTP ${response.status} ${body?.error?.message ?? ""}`.trim(),
      );
    }

    const raw = body?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("OpenRouter response had no message content");

    const parsed = parseGeneratedContent(raw);

    // The disclosure and X's character limit are compliance/platform
    // constraints, not the model's job to get right -- enforce both
    // deterministically the same way the plain templates do, regardless
    // of what the model produced.
    return {
      telegram: `${parsed.telegram.trim()}\n\n${DISCLOSURE_TEXT.telegram}`,
      x: fitWithDisclosure(parsed.x.trim(), DISCLOSURE_TEXT.x, this.limits.x),
      webSummary: `${parsed.webSummary.trim()}\n\n${DISCLOSURE_TEXT.web}`,
    };
  }
}

function parseGeneratedContent(raw: string): { telegram: string; x: string; webSummary: string } {
  // Models occasionally wrap JSON in a markdown fence despite instructions
  // not to -- strip one if present before parsing, rather than failing.
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let candidate: unknown;
  try {
    candidate = JSON.parse(unfenced);
  } catch {
    throw new Error("OpenRouter response was not valid JSON");
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as Record<string, unknown>).telegram !== "string" ||
    typeof (candidate as Record<string, unknown>).x !== "string" ||
    typeof (candidate as Record<string, unknown>).webSummary !== "string"
  ) {
    throw new Error(
      'OpenRouter response JSON is missing a required "telegram"/"x"/"webSummary" string field',
    );
  }

  return candidate as { telegram: string; x: string; webSummary: string };
}

/** Fits `draft` ahead of `disclosure` within `limit` chars, never truncating the disclosure itself. */
function fitWithDisclosure(draft: string, disclosure: string, limit: number): string {
  const suffix = `\n${disclosure}`;
  const availableForDraft = limit - suffix.length;
  const fittedDraft =
    availableForDraft > 0 && draft.length > availableForDraft
      ? `${draft.slice(0, Math.max(0, availableForDraft - 1))}…`
      : draft;
  const content = `${fittedDraft}${suffix}`;
  return content.length <= limit ? content : content.slice(0, limit);
}

export function createOpenRouterContentGenerator(
  credentials?: Partial<OpenRouterCredentials>,
): ContentGenerator {
  if (credentials?.apiKey && credentials.model) {
    return new OpenRouterContentGenerator({ apiKey: credentials.apiKey, model: credentials.model });
  }
  return new TemplateContentGenerator();
}
