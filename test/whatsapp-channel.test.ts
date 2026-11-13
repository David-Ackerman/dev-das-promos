import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendWhatsApp } from "../src/publishers/whatsapp.ts";
import { mockFetch } from "./helpers.ts";

const wa = { mode: "evolution", groupIds: [], evolution: { baseUrl: "https://evo.test", apiKey: "k", instance: "promos" } } as never;
const attrs = () => new Response(JSON.stringify({ status: 500, response: { message: ["TypeError: Cannot read properties of undefined (reading 'attrs')"] } }), { status: 500 });

describe("WhatsApp through Evolution", () => {
  it("a channel whose photo upload fails still gets the post, as text with the link", async () => {
    const f = mockFetch([
      ["/message/sendMedia/", attrs],
      ["/message/sendText/", () => ({ key: { id: "TXT1" } })],
    ]);
    try {
      const id = await sendWhatsApp(wa, "120363434512137278@newsletter", "Oferta 👉 https://x/go/abc", "https://img/1.jpg");
      assert.equal(id, "TXT1");
      assert.equal(f.to("/message/sendText/")[0]!.body.number, "120363434512137278@newsletter");
      assert.equal(f.to("/message/sendText/")[0]!.body.linkPreview, true);
    } finally {
      f.restore();
    }
  });

  it("a group keeps the photo error (no silent downgrade there)", async () => {
    const f = mockFetch([["/message/sendMedia/", attrs], ["/message/sendText/", () => ({ key: { id: "TXT1" } })]]);
    try {
      await assert.rejects(sendWhatsApp(wa, "123-456@g.us", "Oferta", "https://img/1.jpg"), /HTTP 500/);
      assert.equal(f.to("/message/sendText/").length, 0);
    } finally {
      f.restore();
    }
  });
});
