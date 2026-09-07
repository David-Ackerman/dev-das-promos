import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password.js";

describe("hashPassword", () => {
  it("returns a bcrypt hash that is not the plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("produces a different hash each time due to random salting", async () => {
    const [hashA, hashB] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);
    expect(hashA).not.toBe(hashB);
  });
});

describe("verifyPassword", () => {
  it("succeeds for the correct password", async () => {
    const hash = await hashPassword("s3cr3t-password");
    await expect(verifyPassword("s3cr3t-password", hash)).resolves.toBe(true);
  });

  it("fails for an incorrect password", async () => {
    const hash = await hashPassword("s3cr3t-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("fails when comparing against an unrelated hash", async () => {
    const hashA = await hashPassword("password-a");
    await expect(verifyPassword("password-b", hashA)).resolves.toBe(false);
  });
});
