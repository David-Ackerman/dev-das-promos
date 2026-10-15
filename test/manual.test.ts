import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  externalIdFrom,
  marketplaceOf,
  parsePriceToken,
  parseProductPage,
  parseSubmission,
  titleFromUrl,
  unwrapVerification,
} from "../src/manual.ts";

describe("links sent to the bot", () => {
  it("reads link, prices and text from the message", () => {
    assert.deepEqual(parseSubmission("https://amzn.to/3abc 129,90 199,90"), {
      link: "https://amzn.to/3abc",
      priceCents: 12990,
      originalPriceCents: 19990,
      caption: undefined,
    });
    const shared = parseSubmission("Olha esse: Fone JBL https://mercadolivre.com/sec/1xY R$ 1.299 R$1.099,90 que preço\nCorre!");
    assert.equal(shared?.link, "https://mercadolivre.com/sec/1xY");
    assert.equal(shared?.priceCents, 109990, "lowest number is the price");
    assert.equal(shared?.originalPriceCents, 129900);
    assert.equal(shared?.caption, "que preço\nCorre!");
    assert.equal(parseSubmission("https://amzn.to/x).")?.link, "https://amzn.to/x");
    assert.equal(parseSubmission("sem link aqui"), undefined);
    assert.equal(parsePriceToken("129.90"), 12990);
    assert.equal(parsePriceToken("abc"), undefined);
  });

  it("recognises stores, product ids and names in URLs", () => {
    assert.equal(marketplaceOf("https://amzn.to/abc"), "amazon");
    assert.equal(marketplaceOf("https://www.amazon.com.br/dp/B0ABCDEFGH"), "amazon");
    assert.equal(marketplaceOf("https://mercadolivre.com/sec/abc"), "mercadolivre");
    assert.equal(marketplaceOf("https://produto.mercadolivre.com.br/MLB-123456789-x-_JM"), "mercadolivre");
    assert.equal(marketplaceOf("https://amazon.com.evil.io/dp/B0ABCDEFGH"), undefined);
    assert.equal(marketplaceOf("https://shopee.com.br/x"), undefined);
    assert.equal(externalIdFrom("amazon", "https://www.amazon.com.br/Fone/dp/b0abcdefgh?tag=x-20"), "B0ABCDEFGH");
    assert.equal(externalIdFrom("mercadolivre", "https://produto.mercadolivre.com.br/MLB-3846028617-fone-_JM"), "MLB3846028617");
    assert.equal(externalIdFrom("mercadolivre", "https://www.mercadolivre.com.br/apple-iphone/p/MLB1027172669"), "MLB1027172669");
    assert.equal(titleFromUrl("https://www.amazon.com.br/Fone-Bluetooth-JBL-Tune/dp/B0ABCDEFGH"), "Fone Bluetooth JBL Tune");
    assert.equal(titleFromUrl("https://produto.mercadolivre.com.br/MLB-3846028617-fone-de-ouvido-jbl-_JM"), "fone de ouvido jbl");
    assert.equal(titleFromUrl("https://www.mercadolivre.com.br/apple-iphone-15-128-gb-preto/p/MLB1027172669"), "apple iphone 15 128 gb preto");
    assert.equal(
      unwrapVerification("https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Fwww.mercadolivre.com.br%2Fx%2Fp%2FMLB1"),
      "https://www.mercadolivre.com.br/x/p/MLB1",
    );
    assert.equal(unwrapVerification("https://x.com/?go=https%3A%2F%2Fevil.io"), "https://x.com/?go=https%3A%2F%2Fevil.io");
  });

  it("reads an Amazon product page", () => {
    const html = `<html><head><meta property="og:title" content="Amazon.com.br: Fone X: Eletrônicos"></head><body>
      <span id="productTitle" class="a-size-large">  Fone &amp; Microfone   JBL  </span>
      <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/big.jpg">
      <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">R$&nbsp;1.299,90</span></span>
      <span class="a-price a-text-price" data-a-strike="true" data-a-color="secondary"><span class="a-offscreen">R$ 1.999,00</span></span></div></body></html>`;
    assert.deepEqual(parseProductPage("amazon", html), {
      title: "Fone & Microfone JBL",
      imageUrl: "https://m.media-amazon.com/images/I/big.jpg",
      priceCents: 129990,
      originalPriceCents: 199900,
    });
  });

  it("reads a Mercado Livre page through JSON-LD", () => {
    const html = `<meta property="og:image" content="https://http2.mlstatic.com/a.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Air Fryer 4L","offers":{"@type":"Offer","price":299.9}}</script>
      <s class="andes-money-amount andes-money-amount--previous" aria-label="Antes: 1.399 reais com 90 centavos">`;
    assert.deepEqual(parseProductPage("mercadolivre", html), {
      title: "Air Fryer 4L",
      imageUrl: "https://http2.mlstatic.com/a.jpg",
      priceCents: 29990,
      originalPriceCents: 139990,
    });
    assert.deepEqual(parseProductPage("mercadolivre", "<html>captcha</html>"), {
      title: undefined,
      imageUrl: undefined,
      priceCents: undefined,
    });
  });
});
