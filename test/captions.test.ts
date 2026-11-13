import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanProductName, generateCaption, parseAiJson, recentBlock } from "../src/ai.ts";
import { loadAiConfig } from "../src/config.ts";
import { renderTelegram, renderWhatsApp, renderX } from "../src/render.ts";
import { mockFetch, testConfig } from "./helpers.ts";

describe("captions: variety and short product names", () => {
  it("reads the short name the AI suggests, and drops odd ones", () => {
    assert.equal(parseAiJson('{"texto":"Alexa no pulso e mergulho sem medo","tweet":"x","nome":"Smartwatch Bettdow"}').nome, "Smartwatch Bettdow");
    assert.equal(cleanProductName(" “Fone JBL Tune 520BT” "), "Fone JBL Tune 520BT");
    assert.equal(cleanProductName("Fone por R$ 99,90 em https://x.com"), "Fone por em");
    assert.equal(cleanProductName("Um nome comprido demais com palavras demais pra caber aqui"), undefined);
    assert.equal(cleanProductName(""), undefined);
  });

  it("tells the model the channel's latest lines, so the new one is different", async () => {
    const cfg = loadAiConfig({ AI_API_KEY: "k", AI_MODEL: "m" });
    const f = mockFetch([["chat/completions", () => ({ choices: [{ message: { content: '{"texto":"Alexa no pulso e mergulho sem medo 🌊","tweet":"Alexa no pulso","tag":"Bettdow","nome":"Smartwatch Bettdow"}' } }] })]]);
    try {
      const c = await generateCaption(cfg, { marketplace: "amazon", externalId: "1", title: "Bettdow SmartWatch, relogio smartwatch com Ecrã tátil e Alexa, à prova d'água IP68", productUrl: "https://a", priceCents: 10830, discountPct: 42 }, undefined, { recent: ["Fone no precinho pra quem tá liso", "Teclado que salva seu bolso"] });
      assert.equal(c.name, "Smartwatch Bettdow");
      const ask = f.to("chat/completions")[0]!.body;
      assert.match(ask.messages[1].content, /Frases recentes do canal[\s\S]*- Teclado que salva seu bolso/);
      assert.match(ask.messages[0].content, /NÃO fale de dinheiro, bolso/);
    } finally {
      f.restore();
    }
    assert.equal(recentBlock([]), "");
  });

  it("posts show the short name and no footer by default", () => {
    const cfg = testConfig();
    assert.equal(cfg.footer, "");
    const p = { caption: "Alexa no pulso", captionShort: "Alexa no pulso", title: "Bettdow SmartWatch, relogio smartwatch com Ecrã tátil e Alexa, à prova d'água IP68, relogio feminino e masculino", shortTitle: "Smartwatch Bettdow", marketplace: "amazon" as const, priceCents: 10830, originalPriceCents: 18600, discountPct: 42, link: "https://l", footer: cfg.footer };
    const tg = renderTelegram(p);
    assert.match(tg, /🛍️ <b>Smartwatch Bettdow<\/b>/);
    assert.doesNotMatch(tg, /publi|afiliado|relogio feminino/);
    assert.match(renderWhatsApp(p), /🛍️ \*Smartwatch Bettdow\*/);
    assert.match(renderX(p, "https://l"), /Smartwatch Bettdow por R\$/);
    assert.match(renderTelegram({ ...p, shortTitle: null }), /Bettdow SmartWatch, relogio/, "no short name: the title, as before");
  });
});
