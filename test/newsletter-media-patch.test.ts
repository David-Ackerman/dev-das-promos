import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

// The Evolution-server patch (deploy/evolution/patches) with a fake Baileys and socket.
process.env.NEWSLETTER_MEDIA_PATCH_DISABLED = "1"; // don't hook require() in the test process
const { patchSocket, wrapBaileys } = createRequire(import.meta.url)("../deploy/evolution/patches/newsletter-media.cjs");

const photo = Buffer.from("raw jpeg bytes");
const fakeBaileys = {
  downloadContentFromMessage: async (media: { mediaKey: unknown }, type: string) => {
    assert.ok(media.mediaKey);
    assert.equal(type, "image");
    return (async function* () {
      yield photo.subarray(0, 4);
      yield photo.subarray(4);
    })();
  },
  proto: { Message: { fromObject: (o: unknown) => o } },
  generateMessageIDV2: () => "MSGID",
  encodeNewsletterMessage: (m: unknown) => Buffer.from(JSON.stringify(m)),
  generateWAMessageFromContent: (_jid: string, message: unknown) => ({ key: {}, message }),
};

function fakeSocket() {
  const calls = { nodes: [] as any[], original: [] as any[], refresh: [] as boolean[] };
  const sock = {
    user: { id: "5511@s.whatsapp.net" },
    refreshMediaConn: async (force: boolean) => {
      calls.refresh.push(force);
      return { auth: "a/b+c", hosts: [{ hostname: "mmg.test" }] };
    },
    sendNode: async (node: unknown) => void calls.nodes.push(node),
    sendMessage: async (...args: unknown[]) => {
      calls.original.push(args);
      return { key: { id: "ORIG" } };
    },
  };
  return { sock, calls };
}

const forward = (message: unknown) => ({ forward: { key: { remoteJid: "me", fromMe: true }, message } });
const image = { imageMessage: { mediaKey: Buffer.from("k"), url: "https://mmg/o1/x", directPath: "/o1/x", mimetype: "image/jpeg", caption: "Oferta 👉 link" } };

describe("Evolution patch: photos to WhatsApp Channels", () => {
  it("re-uploads a channel photo raw to the newsletter path and sends it as a media message", async () => {
    const { sock, calls } = fakeSocket();
    const uploads: { url: string; body: Buffer; headers: Record<string, string> }[] = [];
    const fetchImpl = async (url: string, init: any) => {
      uploads.push({ url, body: init.body, headers: init.headers });
      return Response.json({ url: "https://mmg/n", direct_path: "/newsletter/x", handle: "H1", thumbnail_info: { thumbnail_sha256: Buffer.from("t").toString("base64"), thumbnail_direct_path: "/thumb" } });
    };
    patchSocket(fakeBaileys, sock, fetchImpl);
    const sent = await sock.sendMessage("120363@newsletter", forward(image), {});

    assert.equal(calls.original.length, 0, "Evolution's own (invisible) path is not used");
    const sha = createHash("sha256").update(photo).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal(uploads[0]!.url, `https://mmg.test/newsletter/newsletter-image/${sha}?auth=a%2Fb%2Bc&token=${sha}&server_thumb_gen=1`);
    assert.deepEqual(uploads[0]!.body, photo, "raw bytes, not encrypted");
    assert.equal(uploads[0]!.headers["Content-Type"], "application/octet-stream");

    const node = calls.nodes[0];
    assert.deepEqual(node.attrs, { to: "120363@newsletter", id: "MSGID", type: "media", media_id: "H1" });
    assert.equal(node.content[0].tag, "plaintext");
    assert.deepEqual(node.content[0].attrs, { mediatype: "image" });
    const msg = JSON.parse(node.content[0].content.toString()).imageMessage;
    assert.equal(msg.directPath, "/newsletter/x");
    assert.equal(msg.caption, "Oferta 👉 link");
    assert.equal(msg.fileLength, photo.length);
    assert.equal(msg.url, undefined);
    assert.equal(msg.mediaKey, undefined);
    assert.equal(msg.thumbnailDirectPath, "/thumb");
    assert.deepEqual(sent.key, { remoteJid: "120363@newsletter", fromMe: true, id: "MSGID" });
  });

  it("errors when the channel upload fails, instead of 'sending' a photo nobody sees", async () => {
    const { sock, calls } = fakeSocket();
    patchSocket(fakeBaileys, sock, async () => Response.json({ error: "nope" }, { status: 400 }));
    await assert.rejects(sock.sendMessage("120363@newsletter", forward(image), {}), /channel image failed/);
    assert.equal(calls.nodes.length, 0);
    assert.equal(calls.original.length, 0);
    assert.deepEqual(calls.refresh, [false, true], "retries once with a fresh media connection");
  });

  it("leaves groups, chats and channel text alone", async () => {
    const { sock, calls } = fakeSocket();
    patchSocket(fakeBaileys, sock, async () => assert.fail("no upload"));
    await sock.sendMessage("123-456@g.us", forward(image), {});
    await sock.sendMessage("120363@newsletter", { text: "oi" }, {});
    assert.equal(calls.original.length, 2);
    assert.equal(calls.nodes.length, 0);
  });

  it("wraps makeWASocket as both the default and the named export", () => {
    const { sock } = fakeSocket();
    const ns = { ...fakeBaileys, default: () => sock, makeWASocket: () => sock, other: 1 };
    const wrapped = wrapBaileys(ns);
    assert.equal(wrapped.__esModule, true);
    assert.equal(wrapped.other, 1);
    const made = wrapped.default({});
    assert.equal(made, sock);
    assert.equal(made.__newsletterMediaPatched, true);
    assert.equal(wrapped.makeWASocket({}).__newsletterMediaPatched, true);
  });
});
