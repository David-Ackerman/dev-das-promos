const COMBINING_DIACRITICS = /\p{M}/gu;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/**
 * Generates a short, URL-safe, non-guessable code for /go/:code redirects.
 * Excludes visually-ambiguous characters (0/O, 1/l/I) on purpose since
 * these codes may end up printed or hand-typed.
 */
export function generateRedirectCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}
