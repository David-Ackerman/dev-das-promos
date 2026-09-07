import { describe, expect, it } from "vitest";
import { DISCLOSURE_TEXT } from "../disclosure.js";

describe("DISCLOSURE_TEXT", () => {
  it("defines disclosure copy for every publication channel", () => {
    expect(Object.keys(DISCLOSURE_TEXT).sort()).toEqual(["telegram", "web", "x"]);
  });

  it("provides non-empty text for each channel", () => {
    for (const channel of Object.keys(DISCLOSURE_TEXT) as Array<keyof typeof DISCLOSURE_TEXT>) {
      expect(DISCLOSURE_TEXT[channel].length).toBeGreaterThan(0);
    }
  });

  it("marks the telegram and x copy as sponsored content", () => {
    expect(DISCLOSURE_TEXT.telegram).toMatch(/#publi/);
    expect(DISCLOSURE_TEXT.x).toMatch(/#publi/);
  });

  it("mentions affiliate commission in the web disclosure", () => {
    expect(DISCLOSURE_TEXT.web.toLowerCase()).toContain("comiss");
  });
});
