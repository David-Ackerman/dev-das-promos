import { afterEach, describe, expect, it, vi } from "vitest";
import { XPublisher } from "../publishers/x-publisher.js";

const CREDENTIALS = {
  apiKey: "consumer-key",
  apiSecret: "consumer-secret",
  accessToken: "access-token",
  accessTokenSecret: "access-token-secret",
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("XPublisher", () => {
  it("returns a published result with the tweet id on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: "12345", text: "hello" } }));
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new XPublisher(CREDENTIALS);
    const result = await publisher.publish({
      dealCandidateId: "d1",
      channel: "x",
      content: "hello",
    });

    expect(result.status).toBe("published");
    expect(result.externalPublicationId).toBe("12345");
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it("returns a failed result with a meaningful message on a non-2xx X error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        errors: [{ message: "Forbidden", detail: "You are not permitted to perform this action." }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new XPublisher(CREDENTIALS);
    const result = await publisher.publish({
      dealCandidateId: "d1",
      channel: "x",
      content: "hello",
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("You are not permitted to perform this action.");
  });

  it("returns a failed result with a meaningful message on a title/detail error body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { title: "Unauthorized", detail: "Invalid or expired token." }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new XPublisher(CREDENTIALS);
    const result = await publisher.publish({
      dealCandidateId: "d1",
      channel: "x",
      content: "hello",
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("Invalid or expired token.");
  });

  it("returns a failed result when fetch rejects at the network level", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new XPublisher(CREDENTIALS);
    const result = await publisher.publish({
      dealCandidateId: "d1",
      channel: "x",
      content: "hello",
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("network down");
  });

  it("truncates content longer than X's character limit before posting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: "1", text: "x" } }));
    vi.stubGlobal("fetch", fetchMock);

    const longContent = "a".repeat(300);
    const publisher = new XPublisher(CREDENTIALS);
    await publisher.publish({ dealCandidateId: "d1", channel: "x", content: longContent });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestInit = call[1];
    const sentBody = JSON.parse(requestInit.body as string) as { text: string };
    expect(sentBody.text.length).toBeLessThanOrEqual(280);
    expect(sentBody.text.endsWith("…")).toBe(true);
  });

  it("builds a well-formed OAuth 1.0a Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: "1", text: "hi" } }));
    vi.stubGlobal("fetch", fetchMock);

    const publisher = new XPublisher(CREDENTIALS);
    await publisher.publish({ dealCandidateId: "d1", channel: "x", content: "hi" });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestInit = call[1];
    const headers = requestInit.headers as Record<string, string>;
    const authHeader = headers.authorization as string;

    expect(authHeader).toBeDefined();
    expect(authHeader.startsWith("OAuth ")).toBe(true);

    // Parse out each oauth_* key="value" pair.
    const paramsString = authHeader.slice("OAuth ".length);
    const pairs = paramsString.split(", ");
    const params: Record<string, string> = {};
    for (const pair of pairs) {
      const match = pair.match(/^([a-zA-Z_]+)="([^"]*)"$/);
      expect(match).not.toBeNull();
      const [, key, value] = match as RegExpMatchArray;
      params[key as string] = value as string;
    }

    expect(params.oauth_consumer_key).toBe(CREDENTIALS.apiKey);
    expect(params.oauth_token).toBe(CREDENTIALS.accessToken);
    expect(params.oauth_signature_method).toBe("HMAC-SHA1");
    expect(params.oauth_version).toBe("1.0");
    expect(params.oauth_timestamp).toMatch(/^\d+$/);
    expect(params.oauth_nonce).toMatch(/^[0-9a-f]+$/);
    expect(params.oauth_signature).toBeTruthy();
    // Every comma-separated segment was successfully parsed as key="value" above,
    // so the structure (quoting + comma separation) is already verified.
    expect(pairs.length).toBe(7);
  });
});
