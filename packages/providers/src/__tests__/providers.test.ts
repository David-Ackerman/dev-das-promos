import { describe, expect, it } from "vitest";
import { AmazonBrazilProvider } from "../amazon-br.js";
import { MercadoLivreProvider } from "../mercado-livre.js";
import { MOCK_CATALOG } from "../mock-catalog.js";
import { createProviderRegistry } from "../registry.js";
import { ShopeeBrazilProvider } from "../shopee-br.js";

describe("AmazonBrazilProvider", () => {
  const provider = new AmazonBrazilProvider("test-tag-20");

  it("reports its marketplace", () => {
    expect(provider.marketplace).toBe("amazon_br");
  });

  it("fetches an offer for every catalog entry", async () => {
    const offers = await provider.fetchOffers();
    expect(offers).toHaveLength(MOCK_CATALOG.length);
    for (const offer of offers) {
      expect(offer.priceCents).toBeGreaterThan(0);
      expect(offer.currency).toBe("BRL");
    }
  });

  it("respects the limit option", async () => {
    const offers = await provider.fetchOffers({ limit: 3 });
    expect(offers).toHaveLength(3);
  });

  it("filters by category", async () => {
    const offers = await provider.fetchOffers({ category: "Pets" });
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.category === "Pets")).toBe(true);
  });

  it("returns deterministic external ids across calls", async () => {
    const [first] = await provider.fetchOffers({ limit: 1 });
    const [second] = await provider.fetchOffers({ limit: 1 });
    expect(first?.externalId).toBe(second?.externalId);
  });

  it("looks up a product by external id", async () => {
    const [offer] = await provider.fetchOffers({ limit: 1 });
    const product = await provider.getProduct(offer!.externalId);
    expect(product?.productName).toBe(offer!.productName);
  });

  it("returns null for an unknown external id", async () => {
    const product = await provider.getProduct("does-not-exist");
    expect(product).toBeNull();
  });

  it("builds an affiliate url carrying the configured tag", async () => {
    const [offer] = await provider.fetchOffers({ limit: 1 });
    const product = await provider.getProduct(offer!.externalId);
    const affiliateUrl = await provider.buildAffiliateUrl(product!, {
      campaign: "telegram-launch",
    });
    const parsed = new URL(affiliateUrl);
    expect(parsed.searchParams.get("tag")).toBe("test-tag-20");
    expect(parsed.searchParams.get("ascsubtag")).toBe("telegram-launch");
  });
});

describe("ShopeeBrazilProvider", () => {
  const provider = new ShopeeBrazilProvider("test-affiliate");

  it("reports its marketplace", () => {
    expect(provider.marketplace).toBe("shopee_br");
  });

  it("builds an affiliate url carrying the configured affiliate id", async () => {
    const [offer] = await provider.fetchOffers({ limit: 1 });
    const product = await provider.getProduct(offer!.externalId);
    const affiliateUrl = await provider.buildAffiliateUrl(product!, { subId: "abc123" });
    const parsed = new URL(affiliateUrl);
    expect(parsed.searchParams.get("af_id")).toBe("test-affiliate");
    expect(parsed.searchParams.get("sub_id")).toBe("abc123");
  });
});

describe("MercadoLivreProvider", () => {
  const provider = new MercadoLivreProvider("test-affiliate");

  it("reports its marketplace", () => {
    expect(provider.marketplace).toBe("mercado_livre");
  });

  it("fetches an offer for every catalog entry", async () => {
    const offers = await provider.fetchOffers();
    expect(offers).toHaveLength(MOCK_CATALOG.length);
    for (const offer of offers) {
      expect(offer.priceCents).toBeGreaterThan(0);
      expect(offer.currency).toBe("BRL");
    }
  });

  it("returns deterministic external ids across calls", async () => {
    const [first] = await provider.fetchOffers({ limit: 1 });
    const [second] = await provider.fetchOffers({ limit: 1 });
    expect(first?.externalId).toBe(second?.externalId);
    expect(first?.externalId).toMatch(/^MLB\d+$/);
  });

  it("looks up a product by external id", async () => {
    const [offer] = await provider.fetchOffers({ limit: 1 });
    const product = await provider.getProduct(offer!.externalId);
    expect(product?.productName).toBe(offer!.productName);
  });

  it("returns null for an unknown external id", async () => {
    const product = await provider.getProduct("does-not-exist");
    expect(product).toBeNull();
  });

  it("builds an affiliate url carrying the configured affiliate id", async () => {
    const [offer] = await provider.fetchOffers({ limit: 1 });
    const product = await provider.getProduct(offer!.externalId);
    const affiliateUrl = await provider.buildAffiliateUrl(product!, {
      campaign: "telegram-launch",
    });
    const parsed = new URL(affiliateUrl);
    expect(parsed.searchParams.get("matt_word")).toBe("test-affiliate");
    expect(parsed.searchParams.get("matt_tool")).toBe("telegram-launch");
  });
});

describe("createProviderRegistry", () => {
  it("returns a provider for every supported marketplace", () => {
    const registry = createProviderRegistry();
    expect(registry.amazon_br.marketplace).toBe("amazon_br");
    expect(registry.shopee_br.marketplace).toBe("shopee_br");
    expect(registry.mercado_livre.marketplace).toBe("mercado_livre");
  });
});
