import { describe, expect, it } from "vitest";
import { generateRedirectCode, slugify } from "../slug.js";

describe("slugify", () => {
  it("lowercases and hyphenates a simple title", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips accents and diacritics", () => {
    expect(slugify("Promoção Relâmpago")).toBe("promocao-relampago");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("Fone de Ouvido -- 50% OFF!!")).toBe("fone-de-ouvido-50-off");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Great Deal--  ")).toBe("great-deal");
  });

  it("truncates to 96 characters", () => {
    const longTitle = "a".repeat(200);
    const result = slugify(longTitle);
    expect(result.length).toBe(96);
    expect(result).toBe("a".repeat(96));
  });

  it("returns an empty string when input has no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("generateRedirectCode", () => {
  it("generates a code of the default length", () => {
    expect(generateRedirectCode()).toHaveLength(8);
  });

  it("generates a code of a custom length", () => {
    expect(generateRedirectCode(12)).toHaveLength(12);
  });

  it("only uses characters from the unambiguous alphabet", () => {
    const code = generateRedirectCode(64);
    expect(code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/);
  });

  it("excludes visually ambiguous characters", () => {
    const code = generateRedirectCode(200);
    expect(code).not.toMatch(/[01ilo]/);
  });

  it("generates different codes across calls (extremely unlikely to collide)", () => {
    const a = generateRedirectCode(16);
    const b = generateRedirectCode(16);
    expect(a).not.toBe(b);
  });
});
