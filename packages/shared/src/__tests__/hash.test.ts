import { describe, expect, it } from "vitest";
import { hashIp } from "../hash.js";

describe("hashIp", () => {
  it("produces a 32-character hex digest", () => {
    const result = hashIp("192.168.0.1", "salt");
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never returns the raw plaintext IP", () => {
    const result = hashIp("192.168.0.1", "salt");
    expect(result).not.toContain("192.168.0.1");
  });

  it("is deterministic for the same ip and salt", () => {
    expect(hashIp("10.0.0.1", "salt-a")).toBe(hashIp("10.0.0.1", "salt-a"));
  });

  it("produces different hashes for different salts", () => {
    expect(hashIp("10.0.0.1", "salt-a")).not.toBe(hashIp("10.0.0.1", "salt-b"));
  });

  it("produces different hashes for different ips", () => {
    expect(hashIp("10.0.0.1", "salt")).not.toBe(hashIp("10.0.0.2", "salt"));
  });
});
