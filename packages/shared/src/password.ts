import bcrypt from "bcryptjs";

/**
 * Password hashing for the MVP admin auth strategy (see
 * packages/database/schema/admin-user.ts). Uses bcryptjs -- a pure-JS
 * implementation with no native build step -- rather than rolling custom
 * crypto. 12 rounds is a reasonable default cost for an admin-only login.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}
