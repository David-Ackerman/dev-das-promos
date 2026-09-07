import { randomUUID } from "node:crypto";
import type { PublicationChannel } from "@dev-das-promos/shared";
import type { PublicationPayload, PublicationResult, Publisher } from "../types.js";

/**
 * Used whenever real channel credentials are absent so the platform can
 * always boot and demo the full publish flow without external accounts.
 * Never fails and never calls the network.
 */
export class MockPublisher implements Publisher {
  constructor(readonly channel: PublicationChannel) {}

  async publish(payload: PublicationPayload): Promise<PublicationResult> {
    return {
      status: "published",
      externalPublicationId: `mock-${this.channel}-${randomUUID().slice(0, 8)}`,
      publishedAt: new Date(),
    };
  }
}
