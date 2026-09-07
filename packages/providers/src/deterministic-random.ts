/**
 * Small seeded PRNG so mock provider output is deterministic per
 * (marketplace, product) pair across calls -- handy for reproducible
 * demos and for tests that assert on provider output without flakiness,
 * while still giving each marketplace/product a distinct "random" value.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function seededInt(seed: string, min: number, max: number): number {
  const rand = seededRandom(seed);
  return Math.floor(min + rand() * (max - min + 1));
}
