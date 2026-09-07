import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenRouterContentGenerator,
  createOpenRouterContentGenerator,
} from "../openrouter-generator.js";
import { TemplateContentGenerator } from "../template-generator.js";
import type { DealContentInput } from "../types.js";

function baseInput(overrides: Partial<DealContentInput> = {}): DealContentInput {
  return {
    productName: "Mouse Gamer RGB 16000 DPI",
    brand: "Redragon",
    marketplace: "amazon_br",
    sellerName: "Amazon.com.br",
    currency: "BRL",
    effectivePriceCents: 12990,
    originalPriceCents: 19990,
    baselinePriceCents: 18000,
    baselineLabel: "média de 90 dias",
    realDiscountPercentage: 27.8,
    dealScore: 91,
    scoreLabel: "Excelente",
    signals: ["Menor preço em 90 dias"],
    reasoning: "Preço bem abaixo da média histórica.",
    goUrl: "https://api.example.com/go/abc123",
    ...overrides,
  };
}

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenRouterContentGenerator", () => {
  it("falls back to the template generator when credentials are absent", () => {
    expect(createOpenRouterContentGenerator()).toBeInstanceOf(TemplateContentGenerator);
    expect(createOpenRouterContentGenerator({ apiKey: "key" })).toBeInstanceOf(
      TemplateContentGenerator,
    );
    expect(createOpenRouterContentGenerator({ model: "z-ai/glm-5.2:free" })).toBeInstanceOf(
      TemplateContentGenerator,
    );
  });

  it("returns the real generator when both apiKey and model are present", () => {
    const generator = createOpenRouterContentGenerator({
      apiKey: "key",
      model: "z-ai/glm-5.2:free",
    });
    expect(generator).toBeInstanceOf(OpenRouterContentGenerator);
  });
});

describe("OpenRouterContentGenerator", () => {
  const credentials = { apiKey: "test-key", model: "z-ai/glm-5.2:free" };

  it("parses a valid JSON response and appends the disclosure to every channel", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                telegram: "Mouse gamer com super desconto!",
                x: "Mouse gamer -28%",
                webSummary: "Um ótimo mouse gamer com desconto real.",
              }),
            },
          },
        ],
      },
    });

    const generator = new OpenRouterContentGenerator(credentials);
    const result = await generator.generateDealContent(baseInput());

    expect(result.telegram).toContain("Mouse gamer com super desconto!");
    expect(result.telegram).toContain("#publi");
    expect(result.webSummary).toContain("Um ótimo mouse gamer com desconto real.");
    expect(result.webSummary).toContain("comissão de afiliado");
    expect(result.x).toContain("#publi");
  });

  it("sends the API key and model in the request", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        choices: [
          { message: { content: JSON.stringify({ telegram: "a", x: "b", webSummary: "c" }) } },
        ],
      },
    });

    const generator = new OpenRouterContentGenerator(credentials);
    await generator.generateDealContent(baseInput());

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("z-ai/glm-5.2:free");
    expect(body.messages).toHaveLength(2);
  });

  it("strips a markdown code fence around the JSON before parsing", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: `\`\`\`json\n${JSON.stringify({ telegram: "a", x: "b", webSummary: "c" })}\n\`\`\``,
            },
          },
        ],
      },
    });

    const generator = new OpenRouterContentGenerator(credentials);
    const result = await generator.generateDealContent(baseInput());
    expect(result.telegram).toContain("a");
  });

  it("never lets the X content exceed the configured limit, disclosure included", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                telegram: "ok",
                x: "x".repeat(500),
                webSummary: "ok",
              }),
            },
          },
        ],
      },
    });

    const generator = new OpenRouterContentGenerator(credentials, { x: 100 });
    const result = await generator.generateDealContent(baseInput());
    expect(result.x.length).toBeLessThanOrEqual(100);
    expect(result.x).toContain("#publi");
  });

  it("throws when the response is not ok", async () => {
    mockFetchOnce({ ok: false, status: 401, body: { error: { message: "Invalid API key" } } });
    const generator = new OpenRouterContentGenerator(credentials);
    await expect(generator.generateDealContent(baseInput())).rejects.toThrow(/401/);
  });

  it("throws when the model content is not valid JSON", async () => {
    mockFetchOnce({
      ok: true,
      body: { choices: [{ message: { content: "not json at all" } }] },
    });
    const generator = new OpenRouterContentGenerator(credentials);
    await expect(generator.generateDealContent(baseInput())).rejects.toThrow(/not valid JSON/);
  });

  it("throws when a required field is missing from the JSON", async () => {
    mockFetchOnce({
      ok: true,
      body: { choices: [{ message: { content: JSON.stringify({ telegram: "only this" }) } }] },
    });
    const generator = new OpenRouterContentGenerator(credentials);
    await expect(generator.generateDealContent(baseInput())).rejects.toThrow(/missing/);
  });

  it("throws when there is no message content at all", async () => {
    mockFetchOnce({ ok: true, body: { choices: [] } });
    const generator = new OpenRouterContentGenerator(credentials);
    await expect(generator.generateDealContent(baseInput())).rejects.toThrow(/no message content/);
  });
});
