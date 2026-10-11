import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramPublisher } from "../publishers/telegram-publisher.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TelegramPublisher", () => {
  it("sets a bounded request signal and returns the Telegram message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new TelegramPublisher({ botToken: "token", chatId: "chat" });
    const result = await publisher.publish({
      dealCandidateId: "deal-1",
      channel: "telegram",
      content: "hello",
    });

    expect(result.status).toBe("published");
    expect(result.externalPublicationId).toBe("42");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });
});
