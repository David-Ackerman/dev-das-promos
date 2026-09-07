import { describe, expect, it } from "vitest";
import {
  average,
  clamp,
  formatCentsBRL,
  fromCents,
  percentageOff,
  roundTo,
  toCents,
} from "../money.js";

describe("toCents", () => {
  it("converts a decimal amount to integer cents", () => {
    expect(toCents(129.9)).toBe(12990);
  });

  it("rounds to the nearest cent instead of truncating", () => {
    expect(toCents(10.005)).toBe(1001);
    expect(toCents(10.001)).toBe(1000);
  });

  it("handles zero and negative amounts", () => {
    expect(toCents(0)).toBe(0);
    expect(toCents(-5.5)).toBe(-550);
  });
});

describe("fromCents", () => {
  it("converts integer cents back to a decimal amount", () => {
    expect(fromCents(12990)).toBe(129.9);
  });

  it("round-trips with toCents for typical values", () => {
    expect(fromCents(toCents(42.5))).toBe(42.5);
  });
});

describe("formatCentsBRL", () => {
  it("formats cents as a BRL currency string", () => {
    const formatted = formatCentsBRL(129990);
    // Intl output uses a non-breaking space between the symbol and value.
    expect(formatted.replace(/ /g, " ")).toBe("R$ 1.299,90");
  });

  it("formats zero cents", () => {
    const formatted = formatCentsBRL(0).replace(/ /g, " ");
    expect(formatted).toBe("R$ 0,00");
  });
});

describe("percentageOff", () => {
  it("computes the percentage discount between two prices", () => {
    expect(percentageOff(10_000, 8_000)).toBeCloseTo(20, 5);
  });

  it("returns 0 when fromPrice is zero or negative", () => {
    expect(percentageOff(0, 100)).toBe(0);
    expect(percentageOff(-100, 50)).toBe(0);
  });

  it("clamps to 0 when the price increased", () => {
    expect(percentageOff(100, 200)).toBe(0);
  });

  it("clamps to 100 at most", () => {
    expect(percentageOff(100, -500)).toBe(100);
  });
});

describe("clamp", () => {
  it("returns the value unchanged when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to the maximum", () => {
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("average", () => {
  it("computes the arithmetic mean", () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns undefined for an empty array", () => {
    expect(average([])).toBeUndefined();
  });

  it("returns the single value for a one-element array", () => {
    expect(average([7])).toBe(7);
  });
});

describe("roundTo", () => {
  it("rounds to 2 decimal places by default", () => {
    expect(roundTo(1.006)).toBe(1.01);
    expect(roundTo(1.234)).toBe(1.23);
  });

  it("rounds to a custom number of decimal places", () => {
    expect(roundTo(1.23456, 3)).toBe(1.235);
  });

  it("rounds to a whole number when decimals is 0", () => {
    expect(roundTo(4.5, 0)).toBe(5);
  });
});
