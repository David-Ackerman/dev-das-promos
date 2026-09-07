import type { PublicationPayload, PublicationResult, Publisher } from "../types.js";

/**
 * "Publishing" to the web channel means making the deal visible on
 * /deal/[slug] on the public site -- there is no external API call. This
 * publisher exists so the web channel goes through the same
 * queue/worker/Publication-record pipeline as every other channel.
 */
export class WebPublisher implements Publisher {
  readonly channel = "web" as const;

  async publish(payload: PublicationPayload): Promise<PublicationResult> {
    return {
      status: "published",
      externalPublicationId: payload.dealCandidateId,
      publishedAt: new Date(),
    };
  }
}
