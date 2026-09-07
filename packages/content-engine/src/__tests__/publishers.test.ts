import { describe, expect, it } from "vitest";
import { MockPublisher } from "../publishers/mock-publisher.js";
import { createPublisherRegistry } from "../publishers/registry.js";
import { createTelegramPublisher } from "../publishers/telegram-publisher.js";
import { createXPublisher } from "../publishers/x-publisher.js";

describe("MockPublisher", () => {
  it("always succeeds without calling the network", async () => {
    const publisher = new MockPublisher("telegram");
    const result = await publisher.publish({
      dealCandidateId: "deal-1",
      channel: "telegram",
      content: "hello",
    });
    expect(result.status).toBe("published");
    expect(result.externalPublicationId).toContain("mock-telegram-");
  });
});

describe("createTelegramPublisher", () => {
  it("falls back to a mock publisher when credentials are absent", async () => {
    const publisher = createTelegramPublisher();
    const result = await publisher.publish({
      dealCandidateId: "d1",
      channel: "telegram",
      content: "x",
    });
    expect(result.status).toBe("published");
    expect(result.externalPublicationId).toContain("mock-telegram-");
  });
});

describe("createXPublisher", () => {
  it("falls back to a mock publisher when credentials are absent", async () => {
    const publisher = createXPublisher();
    const result = await publisher.publish({ dealCandidateId: "d1", channel: "x", content: "x" });
    expect(result.status).toBe("published");
  });
});

describe("createPublisherRegistry", () => {
  it("boots successfully with zero configured credentials (never fails startup)", () => {
    expect(() => createPublisherRegistry()).not.toThrow();
    const registry = createPublisherRegistry();
    expect(registry.telegram.channel).toBe("telegram");
    expect(registry.x.channel).toBe("x");
    expect(registry.web.channel).toBe("web");
  });
});
