import { describe, expect, it } from "vitest";
import {
  categorySlugCandidates,
  normalizeCatalogName,
  productSlugCandidates,
  sameCatalogName,
} from "../catalog-identity.js";

describe("catalog identity", () => {
  it("treats case and diacritic differences as the same catalog name", () => {
    expect(sameCatalogName("Café Espresso", "CAFE ESPRESSO")).toBe(true);
    expect(normalizeCatalogName("Café Espresso")).toBe("cafe espresso");
  });

  it("keeps different names with a shared long prefix distinct", () => {
    const prefix = "A product with a very long shared title ".repeat(4);
    const first = productSlugCandidates(`${prefix}128 GB`);
    const second = productSlugCandidates(`${prefix}256 GB`);
    const sameProduct = productSlugCandidates(`${prefix}128 GB`);

    expect(first[0]).toBe(second[0]);
    expect(first[1]).not.toBe(second[1]);
    expect(first[1]).toBe(sameProduct[1]);
    expect(first.every((slug) => slug.length <= 96)).toBe(true);
    expect(second.every((slug) => slug.length <= 96)).toBe(true);
  });

  it("creates deterministic fallback slugs for names without Latin characters", () => {
    const first = categorySlugCandidates("手机配件");
    const repeated = categorySlugCandidates("手机配件");
    const different = categorySlugCandidates("电脑配件");

    expect(first).toEqual(repeated);
    expect(first[0]).not.toBe(different[0]);
    expect(first[0]).toMatch(/^categoria-[a-f0-9]{16}$/);
  });

  it("keeps distinct symbol-only names from sharing an identity", () => {
    expect(sameCatalogName("🔥", "🎮")).toBe(false);
    expect(productSlugCandidates("🔥")[1]).not.toBe(productSlugCandidates("🎮")[1]);
    expect(categorySlugCandidates("🔥")[0]).not.toBe(categorySlugCandidates("🎮")[0]);
  });
});
