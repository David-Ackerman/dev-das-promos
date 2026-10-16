// `npm run ai:check -- [--rounds 5] [--products 10] [--pause 30] [--worker]`
// Measures how often the AI really writes the caption (vs the stock template),
// with the AI settings from .env / the environment. Also run by
// .github/workflows/ai-check.yml with the production keys.
import { askModel, generateCaption, resolveModel, SEARCH_CAPTION } from "../ai.ts";
import { loadAiConfig } from "../config.ts";
import type { Candidate } from "../types.ts";
import { sleep } from "../util.ts";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};
const rounds = arg("rounds", 5);
const perRound = arg("products", 10);
const pauseSec = arg("pause", 30);
const target = arg("target", 95);
const worker = process.argv.includes("--worker");

const PRODUCTS: Candidate[] = [
  ["Fone de Ouvido Bluetooth JBL Tune 520BT", 19990, 29990],
  ["Smartwatch Amazfit Bip 5 Tela 1.91\"", 39900, 59900],
  ["Caixa de Som Bluetooth Xiaomi Mi Portable 16W", 17990, 24990],
  ["Mouse Gamer Logitech G203 Lightsync RGB", 11990, 19990],
  ["Teclado Mecânico Redragon Kumara K552 Switch Blue", 18990, 26990],
  ["Power Bank Baseus 20000mAh 20W Carregamento Rápido", 12990, 19990],
  ["Carregador Turbo USB-C 33W Xiaomi", 6990, 9990],
  ["Headset Gamer HyperX Cloud Stinger 2", 24990, 34990],
  ["SSD Kingston NV2 1TB NVMe M.2", 37990, 54990],
  ["Webcam Logitech C920 Full HD 1080p", 29990, 44990],
  ["Controle Sem Fio Xbox Series Carbon Black", 38990, 49990],
  ["Tomada Inteligente Wi-Fi Positivo Casa Inteligente", 5990, 8990],
].map(([title, price, original], i) => ({
  marketplace: i % 3 === 0 ? "amazon" : "shopee",
  externalId: `check-${i}`,
  title: title as string,
  productUrl: "https://example.com",
  priceCents: price as number,
  originalPriceCents: original as number,
  discountPct: Math.round((1 - (price as number) / (original as number)) * 100),
}));

const ai = loadAiConfig(process.env);
const entries = ai.models.map((m) => resolveModel(ai, m));
if (!entries.length) throw new Error("AI_MODEL is empty: nothing to check.");
console.log(`AI_MODEL (${entries.length}): ${entries.map((e) => `${e.label}${e.apiKey ? "" : " [no key]"}`).join(", ")}`);
if (ai.niche) console.log(`NICHE: ${ai.niche}`);

// OpenRouter tells us the account's limits (free accounts: 50 free-model requests a day).
const openRouterKey = entries.find((e) => e.baseUrl.includes("openrouter.ai") && e.apiKey)?.apiKey;
if (openRouterKey) {
  const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${openRouterKey}` } });
  const info = ((await res.json().catch(() => ({}))) as { data?: Record<string, unknown> }).data;
  console.log(`OpenRouter account: ${res.ok ? JSON.stringify(info) : `HTTP ${res.status}`}`);
}

console.log("\n== Each model once");
for (const entry of entries) {
  const t = Date.now();
  try {
    const c = await askModel(ai, entry, PRODUCTS[0]!, 25_000);
    console.log(`ok   ${((Date.now() - t) / 1000).toFixed(1)}s  ${entry.label}: ${c.caption}`);
  } catch (error) {
    console.log(`FAIL ${((Date.now() - t) / 1000).toFixed(1)}s  ${(error as Error).message}`);
  }
}

const opts = worker ? { budgetMs: 22_000 } : SEARCH_CAPTION;
let ok = 0;
let total = 0;
const byModel = new Map<string, number>();
for (let r = 1; r <= rounds; r++) {
  console.log(`\n== Round ${r}/${rounds} (${worker ? "Worker budget" : "search budget"})`);
  for (let i = 0; i < perRound; i++) {
    const product = PRODUCTS[(r * perRound + i) % PRODUCTS.length]!;
    const t = Date.now();
    const c = await generateCaption(ai, product, undefined, opts);
    total++;
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (c.model === "template") {
      console.log(`TEMPLATE ${secs}s  ${product.title} -> ${c.error}`);
    } else {
      ok++;
      byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
      console.log(`ok       ${secs}s  [${c.model}] ${c.caption}${c.hashtag ? `  #${c.hashtag}` : ""}`);
    }
  }
  if (r < rounds && pauseSec > 0) await sleep(pauseSec * 1000);
}

if (total) {
  const pct = (ok / total) * 100;
  console.log(`\n== Result: ${ok}/${total} AI texts (${pct.toFixed(0)}%), target ${target}%`);
  for (const [model, n] of byModel) console.log(`   ${n} by ${model}`);
  if (pct < target) process.exitCode = 1;
}
