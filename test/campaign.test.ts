import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeCampaign, parseCampaign } from "../src/config.ts";
import { CAMPAIGN_CRON, campaignTick, createHandler } from "../src/http.ts";
import { renderInput } from "../src/preview.ts";
import { renderTelegram, renderWhatsApp, renderX, xLength } from "../src/render.ts";
import { roundupTelegram } from "../src/roundup.ts";
import { sitePage } from "../src/site.ts";
import type { PostRow } from "../src/types.ts";
import { mockFetch, testConfig } from "./helpers.ts";

const ON = { CAMPAIGN_TAG: "11.11 A maior liquida do ano", CAMPAIGN_HASHTAG: "#1111", CAMPAIGN_UNTIL: "2099-11-11" };
const post = {
  id: 1, product_id: 1, ref: "r", status: "pending", price_cents: 15990, original_price_cents: 24990, discount_pct: 36,
  lowest_seen_cents: null, affiliate_url: "https://a", caption: "Esse teclado vai melhorar sua gameplay", caption_short: "Esse teclado vai melhorar sua gameplay",
  hashtag: "Redragon", ai_model: "groq", preview_chat_id: null, preview_message_id: null, preview_has_photo: false, scheduled_at: null,
  price_from_admin: false, kind: "deal", coupon: null, valid_until: null, marketplace: "shopee", external_id: "1",
  title: "Teclado Mecânico Redragon Kumara K552 RGB Switch Outemu Blue ABNT2", image_url: null, product_url: "https://p",
} as unknown as PostRow;

describe("sale-day campaign", () => {
  it("parses the settings and switches itself off at the end of the day in Brasília", () => {
    assert.equal(parseCampaign("", "", "2026-11-11"), undefined);
    assert.equal(parseCampaign("11.11", "", ""), undefined);
    const c = parseCampaign(" 11.11 A maior liquida do ano ", "#11.11", "2026-11-11")!;
    assert.equal(c.until.toISOString(), "2026-11-12T02:59:59.000Z");
    assert.equal(c.hashtag, "1111");
    assert.ok(activeCampaign({ campaign: c }, new Date("2026-11-11T23:00:00-03:00")));
    assert.equal(activeCampaign({ campaign: c }, new Date("2026-11-12T00:00:01-03:00")), undefined);
    assert.throws(() => parseCampaign("x", "", "amanhã"), /CAMPAIGN_UNTIL/);
  });

  it("puts the slogan on top of every post, and nothing without a campaign", () => {
    const off = testConfig();
    assert.doesNotMatch(renderTelegram(renderInput(off, post, "https://l")), /11\.11/);
    const cfg = testConfig(ON);
    const tg = renderTelegram(renderInput(cfg, post, "https://l"));
    assert.match(tg, /^🔥 <b>11\.11 A maior liquida do ano<\/b>\n\nEsse teclado/);
    assert.match(renderWhatsApp(renderInput(cfg, post, "https://l")), /^🔥 \*11\.11 A maior liquida do ano\*\n\n/);
    const x = renderX(renderInput(cfg, post, "https://l"), "https://l");
    assert.match(x, /^🔥 11\.11 A maior liquida do ano\n/);
    assert.match(x, /#1111$/);
    assert.ok(xLength(x) <= 280);
  });

  it("drops the slogan on X rather than going over 280 characters", () => {
    const cfg = testConfig(ON);
    const long = { ...post, caption_short: "a".repeat(200) } as PostRow;
    const x = renderX(renderInput(cfg, long, "https://l"), "https://l");
    assert.ok(xLength(x) <= 280);
  });

  it("searches every hour inside POSTING_HOURS and proposes the Top at 12h and 19h", () => {
    const cfg = testConfig({ ...ON, POSTING_HOURS: "7-24" });
    const at = (brt: string) => campaignTick(cfg, new Date(`2026-11-11T${brt}:37:00-03:00`));
    assert.deepEqual(at("03"), { collect: false, roundup: false });
    assert.deepEqual(at("10"), { collect: true, roundup: false });
    assert.deepEqual(at("12"), { collect: true, roundup: true });
    assert.deepEqual(at("19"), { collect: true, roundup: true });
    assert.deepEqual(campaignTick(testConfig(), new Date("2026-11-11T15:37:00Z")), { collect: false, roundup: false });
  });

  it("the campaign cron is a no-op without a campaign", async () => {
    const cfg = testConfig({ GH_DISPATCH_TOKEN: "ghp_x", GH_REPO: "me/repo" });
    const handler = createHandler(() => ({ cfg, db: { query: async () => [] } }));
    const f = mockFetch([["api.github.com", () => new Response(null, { status: 204 })]]);
    try {
      const waits: Promise<unknown>[] = [];
      await handler.scheduled({ cron: CAMPAIGN_CRON }, {}, { waitUntil: (p) => void waits.push(p) });
      await Promise.all(waits);
      assert.equal(f.calls.length, 0);
    } finally {
      f.restore();
    }
  });

  it("names the roundup after the campaign and shows the strip on the site", () => {
    const cfg = testConfig(ON);
    assert.match(roundupTelegram(cfg, [post], () => "https://l"), /^🔥 <b>Top 1 do 11\.11<\/b>/);
    assert.match(roundupTelegram(testConfig(), [post], () => "https://l"), /Top 1 da semana/);
    assert.match(sitePage(cfg, []), /<div class="campaign" role="note">🔥 <b>11\.11 A maior liquida do ano<\/b>/);
    assert.doesNotMatch(sitePage(testConfig(), []), /class="campaign"/);
  });
});
