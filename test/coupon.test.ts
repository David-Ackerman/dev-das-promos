import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { couponTitle, howToUse, isExpired, parseCoupon, parseValidity } from "../src/coupon.ts";
import { renderTelegram, renderWhatsApp, renderX, xLength } from "../src/render.ts";

const now = new Date("2026-11-05T15:00:00Z"); // 12:00 in Brasília

describe("coupons", () => {
  it("reads code, link, discount and the labelled lines", () => {
    const d = parseCoupon(
      "/cupom KABUM10 https://tidd.ly/abc 10%\nmínimo 200\nmáximo R$ 50\nvalidade 10/11 23:59\nsó no app, primeira compra\ntexto: Bora economizar\nloja: KaBuM!",
      now,
    );
    assert.equal(d.link, "https://tidd.ly/abc");
    assert.deepEqual(d.coupon, {
      code: "KABUM10",
      pctOff: 10,
      minCents: 20000,
      maxCents: 5000,
      validUntil: "2026-11-11T02:59:00.000Z",
      rules: ["só no app, primeira compra"],
    });
    assert.equal(d.caption, "Bora economizar");
    assert.equal(d.store, "KaBuM!");
  });

  it("handles R$ discounts, 'acima de' on the first line, coupons without code and text discounts", () => {
    const shopee = parseCoupon("/cupom https://s.shopee.com.br/x R$ 20 off acima de 99", now);
    assert.deepEqual(shopee.coupon, { centsOff: 2000, minCents: 9900, rules: [] });
    const frete = parseCoupon("/cupom FRETE https://a.co/x\ndesconto: frete grátis\nvence amanhã", now);
    assert.equal(frete.coupon.code, "FRETE");
    assert.equal(frete.coupon.discountText, "frete grátis");
    assert.equal(frete.coupon.validUntil, "2026-11-07T02:59:00.000Z");
    assert.equal(parseCoupon("/cupom https://x.com/a", now).coupon.code, undefined);
  });

  it("parses validity in Brasília time; a past day without a year is next year", () => {
    assert.equal(parseValidity("10/11 às 18h", now), "2026-11-10T21:00:00.000Z");
    assert.equal(parseValidity("03/01", now), "2027-01-04T02:59:00.000Z");
    assert.equal(parseValidity("hoje", now), "2026-11-06T02:59:00.000Z");
    assert.equal(parseValidity("31/02", now), undefined);
    assert.equal(parseValidity("semana que vem", now), undefined);
    assert.equal(isExpired("2026-11-05T14:00:00Z", now), true);
    assert.equal(isExpired(null, now), false);
  });

  it("explains how to use it, per store, with the code where it goes", () => {
    const coupon = { code: "MELI15", pctOff: 15, minCents: 10000, rules: ["Só no app"] };
    assert.match(howToUse("mercadolivre", coupon).join("\n"), /Inserir código de cupom" e cole \{code\}[\s\S]*pelo menos R\$ 100,00/);
    assert.match(howToUse("kabum", coupon)[1]!, /campo "Cupom"/);
    assert.match(howToUse("shopee", { rules: [] })[0]!, /resgate o cupom/);
    assert.equal(couponTitle(coupon, "Mercado Livre"), "Cupom MELI15 15% OFF no Mercado Livre");
    assert.equal(couponTitle({ pctOff: 5, rules: [] }, "Shopee"), "Cupom 5% OFF na Shopee");
  });

  it("renders coupon posts for Telegram, WhatsApp and X from the data only", () => {
    const input = {
      caption: "Desconto extra <hoje>",
      captionShort: "Desconto extra hoje",
      title: "Cupom",
      marketplace: "mercadolivre",
      priceCents: 0,
      discountPct: 15,
      link: "https://promo.example/go/abc",
      footer: "#publi",
      coupon: { code: "MELI15", pctOff: 15, minCents: 10000, maxCents: 3000, validUntil: "2026-11-11T02:59:00.000Z", rules: ["Só no app"] },
    };
    const tg = renderTelegram(input);
    assert.match(tg, /^Desconto extra &lt;hoje&gt;/);
    assert.match(tg, /🎟️ <b>Cupom Mercado Livre: 15% OFF<\/b>/);
    assert.match(tg, /🔑 Código: <code>MELI15<\/code>/);
    assert.match(tg, /Compras a partir de R\$ 100,00 · desconto máximo de R\$ 30,00/);
    assert.match(tg, /⏰ Válido até 10\/11 às 23:59/);
    assert.match(tg, /📋 <b>Como usar<\/b>\n1\. Toque no link[\s\S]*2\. No resumo da compra, toque em "Inserir código de cupom" e cole <code>MELI15<\/code>/);
    assert.match(tg, /• Só no app/);
    assert.match(tg, /👉 https:\/\/promo\.example\/go\/abc/);
    assert.doesNotMatch(tg, /R\$ 0,00/, "no product price");
    const wa = renderWhatsApp(input);
    assert.match(wa, /\*Cupom Mercado Livre: 15% OFF\*/);
    assert.match(wa, /cole `MELI15`/);
    const x = renderX(input, "https://promo.example/go/x");
    assert.match(x, /🎟️ Cupom MELI15 15% OFF no Mercado Livre · mín\. R\$ 100,00, até 10\/11 23:59/);
    assert.ok(xLength(x) <= 280);
    const long = renderX({ ...input, captionShort: "z".repeat(400) }, "link na bio");
    assert.ok(xLength(long) <= 280, "the call line is cut, never the coupon");
    assert.match(renderTelegram({ ...input, coupon: { ...input.coupon, store: "Mercado Livre Full" } }), /Cupom Mercado Livre Full/);
  });
});
