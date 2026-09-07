import { describe, expect, it } from "vitest";
import {
  buildGoUrl,
  createRedirectCode,
  extractUtmParams,
  isValidRedirectCode,
} from "../redirect.js";

describe("createRedirectCode / isValidRedirectCode", () => {
  it("generates codes that pass validation", () => {
    for (let i = 0; i < 50; i++) {
      const code = createRedirectCode();
      expect(isValidRedirectCode(code)).toBe(true);
    }
  });

  it("rejects codes with disallowed characters", () => {
    expect(isValidRedirectCode("abc$%^")).toBe(false);
    expect(isValidRedirectCode("../../etc/passwd")).toBe(false);
    expect(isValidRedirectCode("")).toBe(false);
  });

  it("rejects codes that are too short or too long", () => {
    expect(isValidRedirectCode("ab")).toBe(false);
    expect(isValidRedirectCode("a".repeat(64))).toBe(false);
  });
});

describe("buildGoUrl", () => {
  it("joins the base url and code with exactly one slash", () => {
    expect(buildGoUrl("https://example.com", "abc123")).toBe("https://example.com/go/abc123");
    expect(buildGoUrl("https://example.com/", "abc123")).toBe("https://example.com/go/abc123");
  });
});

describe("extractUtmParams", () => {
  it("extracts only known utm keys", () => {
    const result = extractUtmParams({
      utm_source: "telegram",
      utm_medium: "social",
      utm_campaign: "launch",
      evil: "<script>alert(1)</script>",
    });
    expect(result).toEqual({
      utmSource: "telegram",
      utmMedium: "social",
      utmCampaign: "launch",
    });
  });

  it("ignores overly long values", () => {
    const result = extractUtmParams({ utm_source: "x".repeat(200) });
    expect(result.utmSource).toBeUndefined();
  });

  it("returns an empty object when no utm params are present", () => {
    expect(extractUtmParams({})).toEqual({});
  });
});
