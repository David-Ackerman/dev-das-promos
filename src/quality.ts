import type { Candidate } from "./types.ts";
import { hasAnyWord, normalizeWords } from "./util.ts";

/**
 * What makes a found offer good enough for the channel, besides the discount:
 * a minimum price (no R$ 10 trinkets), Shopee's rating/sales, real brands for
 * earphones and headsets, and at most N products of the same kind per day.
 */

/**
 * Never in this channel, whatever BLOCKED_WORDS says: underwear, adult items.
 * Whole words, accents ignored.
 */
export const ALWAYS_BLOCKED = [
  "lingerie", "calcinha", "calcinhas", "sutia", "sutias", "cueca", "cuecas", "body rendado", "camisola", "espartilho",
  "sensual", "erotico", "erotica", "sex shop", "sexshop", "vibrador", "preservativo", "lubrificante intimo", "fantasia erotica",
  "biquini",
];

/**
 * Nothing for children, ever: toys, school supplies, kids' books, baby items.
 * (LEGO and Pokémon stay, unless the title says it's for kids or gives an age.)
 */
export const KIDS_WORDS = [
  "infantil", "infantis", "crianca", "criancas", "kids", "kid", "bebe", "bebes", "baby", "menino", "meninos", "menina", "meninas",
  "brinquedo", "brinquedos", "bilingue", "canetinha", "canetinhas", "colorir", "pintar", "lapis de cor", "giz de cera", "escolar",
  "estojo", "massinha", "slime", "fralda", "fraldas", "mamadeira", "chupeta", "berco", "carrinho de bebe", "pelucia", "boneca",
  "bonecas", "educativo", "educativa", "alfabetizacao", "montessori", "maternidade", "enxoval", "primeira infancia",
];
/** "3 anos", "6+ anos", "8 a 12 anos": an age on the box means it's for children. */
const AGE_RE = /\b\d{1,2}\s*(\+|a\s*\d{1,2}|ou mais)?\s*anos\b/;

export function isForKids(title: string): boolean {
  const folded = normalizeWords(title);
  return hasAnyWord(title, KIDS_WORDS) || (AGE_RE.test(folded) && !/\badult/.test(folded));
}

/** Earphones, headsets, "pods": the category full of no-name R$ 10 items. */
const AUDIO_WORDS = ["fone", "fones", "headset", "headphone", "headphones", "earbuds", "earbud", "airpods", "tws", "auricular", "pods", "buds"];

/** Brands people trust for audio. Anything else in that category is skipped. */
export const AUDIO_BRANDS = [
  "jbl", "sony", "samsung", "galaxy buds", "apple", "airpods", "beats", "bose", "sennheiser", "hyperx", "logitech", "razer",
  "steelseries", "corsair", "edifier", "soundcore", "anker", "xiaomi", "redmi", "philips", "audio technica", "audio-technica",
  "marshall", "skullcandy", "jabra", "huawei", "motorola", "lg", "astro", "turtle beach", "havit", "redragon", "fifine",
];

/** Kinds that several word spellings belong to ("fone", "headset", "airpods" are one kind). */
const KIND_GROUPS: [string, string[]][] = [
  ["fone", AUDIO_WORDS],
  ["caixa de som", ["caixa de som", "caixa som", "speaker", "soundbar", "boombox", "partybox"]],
  ["pokemon", ["pokemon", "blister", "booster", "tcg"]],
  ["livro", ["livro", "livros", "manga"]],
  ["perfume", ["perfume", "colonia", "eau", "body splash"]],
  ["relogio", ["smartwatch", "relogio", "smartband"]],
  ["teclado", ["teclado"]],
  ["mouse", ["mouse"]],
  ["monitor", ["monitor"]],
  ["ssd", ["ssd", "pendrive", "cartao de memoria"]],
  ["cadeira", ["cadeira"]],
  ["controle", ["controle", "joystick", "gamepad"]],
];

/** Leading words that say nothing about what the product is ("Kit 2x Novo ..."). */
const LEAD_FILLER = new Set(
  "kit combo novo nova original oficial lancamento promocao oferta super mini mega premium x un unidade unidades par pack conjunto jogo de da do com para".split(" "),
);

/** "the same thing", for the per-day limit: a known group, else the first meaningful word. */
export function productKind(title: string): string {
  for (const [kind, words] of KIND_GROUPS) if (hasAnyWord(title, words)) return kind;
  const words = normalizeWords(title).split(" ").filter((w) => w && !/^\d+x?$/.test(w) && !LEAD_FILLER.has(w));
  const first = words[0] ?? "";
  return first.length > 3 && first.endsWith("s") ? first.slice(0, -1) : first;
}

/** Brands, to tell "the same product" apart from "the same kind of product". */
const BRANDS = [
  ...AUDIO_BRANDS, "amazon", "kindle", "echo", "alexa", "lenovo", "asus", "acer", "dell", "hp", "positivo", "multilaser", "intelbras",
  "tp link", "tp-link", "mercusys", "kingston", "sandisk", "western digital", "wd", "seagate", "crucial", "adata", "lexar", "aoc",
  "nintendo", "xbox", "microsoft", "playstation", "ps5", "ps4", "lego", "funko", "pokemon", "hasbro", "baseus", "ugreen", "realme",
  "machenike", "aula", "attack shark", "fantech", "pichau", "mancer", "dazz", "elgin", "tcl", "nvidia", "amd", "intel", "gigabyte", "msi",
  "garmin", "amazfit", "mondial", "electrolux", "philco", "britania",
];

/** First known brand in the title, or "". */
export function brandOf(title: string): string {
  const folded = ` ${normalizeWords(title)} `;
  let best: { brand: string; at: number } | undefined;
  for (const b of BRANDS) {
    const at = folded.indexOf(` ${normalizeWords(b)} `);
    if (at >= 0 && (!best || at < best.at)) best = { brand: normalizeWords(b), at };
  }
  return best?.brand ?? "";
}

/** "Caixa de Som JBL Xtreme" and "Caixa JBL Extreme 4" are the same thing for the channel: kind + brand. */
export function productFamily(title: string): string {
  const brand = brandOf(title);
  return brand ? `${productKind(title)}:${brand}` : "";
}

export function isAudio(title: string): boolean {
  return hasAnyWord(title, AUDIO_WORDS);
}

export interface QualityRules {
  /** Nothing cheaper than this (cents). */
  minPriceCents: number;
  /** Earphones/headsets: the full price (before the discount) must be at least this, and a known brand. 0 = no audio rule. */
  audioMinCents: number;
  /** Shopee: skip items rated below this / with fewer sales than this (when Shopee says). */
  shopeeMinRating: number;
  shopeeMinSales: number;
}

/** Why an offer isn't good enough, or undefined when it is. */
export function qualityProblem(c: Candidate, rules: QualityRules): string | undefined {
  if (hasAnyWord(c.title, ALWAYS_BLOCKED)) return "off-limits";
  if (isForKids(c.title)) return "kids";
  if (c.priceCents < rules.minPriceCents) return "cheap";
  if (rules.audioMinCents > 0 && isAudio(c.title)) {
    if ((c.originalPriceCents ?? c.priceCents) < rules.audioMinCents) return "audio-cheap";
    if (!hasAnyWord(c.title, AUDIO_BRANDS)) return "audio-brand";
  }
  if (c.marketplace === "shopee") {
    if (c.rating !== undefined && c.rating > 0 && c.rating < rules.shopeeMinRating) return "rating";
    if (c.sales !== undefined && c.sales < rules.shopeeMinSales) return "sales";
  }
  return undefined;
}

/**
 * The topics searched across runs, all for the channel's audience (tech, games,
 * setup, geek stuff) but broad. Override with COLLECT_TOPICS. Each run searches only a few of them
 * (topicsForRun), so the channel gets a mix of everything over the day
 * instead of the same gadgets every time.
 */
export const DEFAULT_TOPICS = [
  // audio, brand names only (the quality rules skip no-name earphones anyway)
  "fone jbl", "headset hyperx", "galaxy buds", "caixa de som jbl", "fone sony",
  // setup and PC
  "teclado mecânico", "mouse logitech", "monitor gamer", "ssd", "hd externo", "webcam", "microfone",
  "cadeira gamer", "suporte para monitor", "placa de vídeo", "memória ram", "roteador wifi",
  // games
  "controle xbox", "controle ps5", "jogos ps5", "nintendo switch", "jogos nintendo switch",
  // geek: reading, collecting, building
  "kindle", "livros de programação", "livros de fantasia", "mangá", "cartas pokémon", "lego", "action figure",
  // everyday tech
  "smartwatch", "power bank", "carregador anker", "echo dot alexa", "tablet", "notebook", "kit chaves de precisão",
];

/** A few topics per run, different every run (the 6-hour slot is the seed); `offset` gives each store its own slice. */
export function topicsForRun(pool: string[], count: number, now = Date.now(), offset = 0): string[] {
  const topics = [...new Set(pool.map((t) => t.trim()).filter(Boolean))];
  if (topics.length <= count) return topics;
  const slot = Math.floor(now / (6 * 3600_000));
  // Deterministic shuffle of the pool per day, then walk it slot by slot.
  const day = Math.floor(slot / 4);
  let seed = day * 2654435761 >>> 0;
  const order = topics.map((t) => t);
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const start = ((slot % 4) * count * 2 + offset * count) % order.length;
  return Array.from({ length: count }, (_, i) => order[(start + i) % order.length] as string);
}
