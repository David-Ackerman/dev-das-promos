import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { describe, expect, it } from "vitest";
import { TemplateContentGenerator } from "../template-generator.js";
import { renderXContent } from "../templates/x.js";
import type { DealContentInput } from "../types.js";

function input(overrides: Partial<DealContentInput> = {}): DealContentInput {
  return {
    productName: "Mouse Gamer RGB 16000 DPI",
    brand: "Redragon",
    marketplace: "amazon_br",
    sellerName: "Amazon.com.br",
    currency: "BRL",
    effectivePriceCents: 12_900,
    originalPriceCents: 19_900,
    baselinePriceCents: 18_000,
    baselineLabel: "média de 90 dias",
    realDiscountPercentage: 28.3,
    dealScore: 91.2,
    scoreLabel: "Exceptional deal",
    signals: ["ALL_TIME_LOW", "HIGH_COMMISSION_CATEGORY"],
    reasoning: "Menor preço já registrado, com boa comissão.",
    goUrl: "https://deals.example.com/go/ab12cd34",
    ...overrides,
  };
}

describe("TemplateContentGenerator", () => {
  const generator = new TemplateContentGenerator();

  it("generates content for all three channels using only supplied facts", async () => {
    const data = input();
    const result = await generator.generateDealContent(data);

    expect(result.telegram).toContain(data.productName);
    expect(result.telegram).toContain(data.goUrl);
    expect(result.telegram).toContain("#publi");

    expect(result.x).toContain(data.goUrl);
    expect(result.x.length).toBeLessThanOrEqual(280);

    expect(result.webSummary).toContain(data.productName);
    expect(result.webSummary.length).toBeGreaterThan(20);
  });

  it("never fabricates a discount comparison when no baseline is available", async () => {
    const data = input({
      baselinePriceCents: undefined,
      baselineLabel: undefined,
      realDiscountPercentage: 0,
    });
    const result = await generator.generateDealContent(data);
    expect(result.webSummary).toContain("não temos histórico de preço suficiente");
  });

  it("always includes the affiliate disclosure on every channel", async () => {
    const data = input();
    const result = await generator.generateDealContent(data);
    expect(result.telegram.toLowerCase()).toMatch(/afiliado|publi/);
    expect(result.x.toLowerCase()).toMatch(/afiliado|ad|publi/);
    expect(result.webSummary.toLowerCase()).toMatch(/comiss[ãa]o de afiliado/);
  });
});

describe("renderXContent", () => {
  it("fits the product name within the configured limit when fixed fields fit", () => {
    const longName = "A".repeat(400);
    const content = renderXContent(input({ productName: longName }), { x: 160 });
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).toContain(input().goUrl);
  });

  it("never truncates the link or disclosure, only the product name", () => {
    const data = input({ productName: "B".repeat(400) });
    const content = renderXContent(data, { x: 150 });
    expect(content).toContain(data.goUrl);
    expect(content).toContain(DISCLOSURE_TEXT.x);
  });

  it("preserves the tracked link and disclosure if fixed fields exceed the limit", () => {
    const data = input({ productName: "A product name that can be omitted" });
    const content = renderXContent(data, { x: 20 });

    expect(content.length).toBeGreaterThan(20);
    expect(content).toContain(data.goUrl);
    expect(content).toContain(DISCLOSURE_TEXT.x);
  });

  it("keeps short product names intact", () => {
    const data = input({ productName: "SSD 1TB" });
    const content = renderXContent(data);
    expect(content).toContain("SSD 1TB");
  });
});
