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
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

const SYSTEM_PROMPT = `You write short, punchy social/web copy for real product deals for a Brazilian Portuguese audience (write in pt-BR).

Rules, no exceptions:
- Use ONLY the facts given to you below. Never invent a price, a stock level,
  a seller claim, an urgency claim, or any detail not explicitly present in the facts.
- Do not include any URL, domain, email address, or markdown link. The
  application adds the tracked offer link separately.
- Do not include a disclosure/ad disclaimer yourself -- it is appended separately after your output.
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

    // Links, disclosures, and platform limits are application-owned
    // constraints: strip model links, then append the tracked URL and
    // disclosure deterministically.
    const telegramDraft = stripLinks(parsed.telegram);
    const xDraft = stripLinks(parsed.x);
    const webSummaryDraft = stripLinks(parsed.webSummary);
    if (!telegramDraft || !xDraft || !webSummaryDraft) {
      throw new Error("OpenRouter response contained no usable copy after removing links");
    }

    return {
      telegram: fitBeforeSuffix(
        telegramDraft,
        `\n\n👉 Ver oferta: ${input.goUrl}\n\n${DISCLOSURE_TEXT.telegram}`,
        4096,
      ),
      x: fitBeforeSuffix(xDraft, `\n${input.goUrl}\n${DISCLOSURE_TEXT.x}`, this.limits.x),
      webSummary: `${webSummaryDraft}\n\n${DISCLOSURE_TEXT.web}`,
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

/** Fits model copy before an application-owned suffix, preserving the tracked link/disclosure. */
function fitBeforeSuffix(draft: string, suffix: string, limit: number): string {
  const availableForDraft = limit - suffix.length;
  if (availableForDraft <= 0) {
    return suffix;
  }
  const fittedDraft =
    availableForDraft > 0 && draft.length > availableForDraft
      ? `${draft.slice(0, Math.max(0, availableForDraft - 1))}…`
      : draft;
  return `${fittedDraft}${suffix}`;
}

/** Prevent model output from adding untracked links to externally published copy. */
function stripLinks(text: string): string {
  const linkPattern = new RegExp(
    [
      String.raw`(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>{}\[\]]+`,
      String.raw`\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}\b(?:\/[^\s<>{}\[\]]*)?`,
      String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/[^\s<>{}\[\]]*)?`,
      String.raw`\blocalhost(?::\d+)?(?:\/[^\s<>{}\[\]]*)?`,
    ].join("|"),
    "gi",
  );

  return text
    .replace(linkPattern, "")
    .replace(/\[\s*\]\s*\(\s*\)|\(\s*\)/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function createOpenRouterContentGenerator(
  credentials?: Partial<OpenRouterCredentials>,
): ContentGenerator {
  if (credentials?.apiKey && credentials.model) {
    return new OpenRouterContentGenerator({ apiKey: credentials.apiKey, model: credentials.model });
  }
  return new TemplateContentGenerator();
}
