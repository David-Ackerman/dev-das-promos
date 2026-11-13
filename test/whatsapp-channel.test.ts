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

describe("Evolution losing its WhatsApp connection", () => {
  const closed = () => new Response(JSON.stringify({ status: 400, response: { message: ["Error: Connection Closed"] } }), { status: 400 });
  const noWait = async () => {};

  it("reconnects with the saved session and sends again", async () => {
    let sent = 0;
    let connected = false;
    const f = mockFetch([
      ["/message/sendText/", () => (sent++ === 0 ? closed() : { key: { id: "OK2" } })],
      ["/instance/connect/", () => ((connected = true), { count: 1 })],
      ["/instance/connectionState/", () => ({ instance: { state: connected ? "open" : "close" } })],
    ]);
    try {
      assert.equal(await sendWhatsApp(wa, "123@newsletter", "Oferta", null, { wait: noWait }), "OK2");
      assert.equal(f.to("/instance/connect/").length, 1);
    } finally {
      f.restore();
    }
  });

  it("says how to fix it when the server wants a new QR code", async () => {
    const f = mockFetch([
      ["/message/sendText/", closed],
      ["/instance/connect/", () => ({ code: "qr", base64: "img", count: 2 })],
      ["/instance/connectionState/", () => ({ instance: { state: "connecting" } })],
    ]);
    try {
      await assert.rejects(sendWhatsApp(wa, "123@newsletter", "Oferta", null, { wait: noWait }), /WhatsApp desconectado do servidor: abra https:\/\/evo\.test\/manager/);
      assert.equal(f.to("/message/sendText/").length, 1, "no retry while disconnected");
    } finally {
      f.restore();
    }
  });

  it("a bad message is not mistaken for a lost connection", async () => {
    const f = mockFetch([["/message/sendText/", () => new Response('{"response":{"message":["number not exists"]}}', { status: 400 })]]);
    try {
      await assert.rejects(sendWhatsApp(wa, "123@g.us", "Oferta", null, { wait: noWait }), /number not exists/);
      assert.equal(f.to("/instance/").length, 0);
    } finally {
      f.restore();
    }
  });
});
