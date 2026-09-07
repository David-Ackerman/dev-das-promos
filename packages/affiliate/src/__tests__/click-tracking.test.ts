import { describe, expect, it } from "vitest";
import { buildClickTrackingRecord, summarizeUserAgent } from "../click-tracking.js";

describe("summarizeUserAgent", () => {
  it("detects mobile chrome", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
      ),
    ).toBe("mobile:chrome");
  });

  it("detects desktop firefox", () => {
    expect(
      summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Firefox/120.0"),
    ).toBe("desktop:firefox");
  });

  it("returns undefined for missing input", () => {
    expect(summarizeUserAgent(undefined)).toBeUndefined();
    expect(summarizeUserAgent(null)).toBeUndefined();
  });
});

describe("buildClickTrackingRecord", () => {
  it("never includes the raw ip address in the record", () => {
    const record = buildClickTrackingRecord({
      ip: "203.0.113.42",
      ipHashSalt: "test-salt",
      userAgent: "Mozilla/5.0 Chrome/120",
      referrer: "https://t.me/somechannel",
    });
    expect(record.ipHash).toBeDefined();
    expect(record.ipHash).not.toContain("203.0.113.42");
    expect(JSON.stringify(record)).not.toContain("203.0.113.42");
  });

  it("produces a stable hash for the same ip and salt", () => {
    const a = buildClickTrackingRecord({
      ip: "203.0.113.42",
      ipHashSalt: "salt",
      userAgent: undefined,
      referrer: undefined,
    });
    const b = buildClickTrackingRecord({
      ip: "203.0.113.42",
      ipHashSalt: "salt",
      userAgent: undefined,
      referrer: undefined,
    });
    expect(a.ipHash).toBe(b.ipHash);
  });

  it("produces a different hash for a different salt", () => {
    const a = buildClickTrackingRecord({
      ip: "1.2.3.4",
      ipHashSalt: "salt-a",
      userAgent: undefined,
      referrer: undefined,
    });
    const b = buildClickTrackingRecord({
      ip: "1.2.3.4",
      ipHashSalt: "salt-b",
      userAgent: undefined,
      referrer: undefined,
    });
    expect(a.ipHash).not.toBe(b.ipHash);
  });

  it("handles a missing ip gracefully", () => {
    const record = buildClickTrackingRecord({
      ip: undefined,
      ipHashSalt: "salt",
      userAgent: undefined,
      referrer: undefined,
    });
    expect(record.ipHash).toBeUndefined();
  });
});
