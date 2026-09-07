import { type ContentLimits, DEFAULT_CONTENT_LIMITS } from "./limits.js";
import { renderTelegramContent } from "./templates/telegram.js";
import { renderWebSummary } from "./templates/web.js";
import { renderXContent } from "./templates/x.js";
import type { ContentGenerator, DealContentInput, GeneratedDealContent } from "./types.js";

/**
 * Default, always-available ContentGenerator: fully deterministic string
 * templates, no network calls, no API keys required. This is what the
 * platform uses unless/until an AI-backed generator is configured (see
 * README "Adding a publication channel" / future AnthropicContentGenerator).
 */
export class TemplateContentGenerator implements ContentGenerator {
  constructor(private readonly limits: ContentLimits = DEFAULT_CONTENT_LIMITS) {}

  async generateDealContent(input: DealContentInput): Promise<GeneratedDealContent> {
    return {
      telegram: renderTelegramContent(input),
      x: renderXContent(input, this.limits),
      webSummary: renderWebSummary(input),
    };
  }
}
