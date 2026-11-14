// Makes photos and videos sent to WhatsApp Channels (@newsletter) actually show up.
//
// Loaded into the Evolution API container with NODE_OPTIONS=--require (see
// docker-compose.yml); nothing in Evolution's own files is changed.
//
// Why: Evolution 2.4 (Baileys 7.0.0-rc.9) uploads channel media like chat media
// (encrypted, to /mms/<type>), so WhatsApp accepts the message but never shows it
// (WhiskeySockets/Baileys#2199). Channels need what WhatsApp Web does
// (Baileys PR #2434 + WhatsApp Web's stanza): the raw file uploaded to
// /newsletter/newsletter-<type>, a message without url / mediaKey, sent as
// <message type="media" media_id=handle> with <plaintext mediatype=...>.
//
// How: when Evolution creates a socket (makeWASocket from "baileys"), its
// sendMessage is wrapped. A channel message carrying an image/video gets the
// media downloaded back, re-uploaded the channel way and sent as above. If
// that fails the send errors (Evolution's normal path would answer OK and the
// photo would never show), and das-promos then posts the text instead. Groups,
// chats and text messages never go through this.
"use strict";
const Module = require("module");
const crypto = require("crypto");

const TAG = "[newsletter-media]";
const KINDS = { imageMessage: "image", videoMessage: "video" };
const DEFAULT_ORIGIN = "https://web.whatsapp.com";

const isNewsletter = (jid) => typeof jid === "string" && jid.endsWith("@newsletter");
/** Base64 as WhatsApp's media servers want it in the upload URL. */
const urlSafeB64 = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function toBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Uploads the raw file to the channel media path; returns direct_path, handle and server thumbnail. */
async function uploadForNewsletter(sock, buffer, mediaType, fetchImpl) {
  const sha256 = crypto.createHash("sha256").update(buffer).digest();
  const token = urlSafeB64(sha256);
  let info = await sock.refreshMediaConn(false);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const { hostname } of info.hosts || []) {
      let url = `https://${hostname}/newsletter/newsletter-${mediaType}/${token}?auth=${encodeURIComponent(info.auth)}&token=${token}&server_thumb_gen=1`;
      if (mediaType === "video") url += "&server_transcode=1";
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          body: buffer,
          headers: { "Content-Type": "application/octet-stream", Origin: DEFAULT_ORIGIN },
          signal: AbortSignal.timeout(60_000),
        });
        const json = await res.json().catch(() => undefined);
        if (json && (json.direct_path || json.url)) return { sha256, json };
        lastError = new Error(`upload to ${hostname} failed: ${JSON.stringify(json)}`);
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt === 0) info = await sock.refreshMediaConn(true);
  }
  throw lastError || new Error("no media host");
}

async function sendNewsletterMedia(baileys, sock, jid, kind, media, opts, fetchImpl) {
  const mediaType = KINDS[kind];
  const buffer = await toBuffer(await baileys.downloadContentFromMessage(media, mediaType));
  const { sha256, json } = await uploadForNewsletter(sock, buffer, mediaType, fetchImpl);
  const thumb = json.thumbnail_info || {};
  const content = {
    mimetype: media.mimetype,
    caption: media.caption || undefined,
    directPath: json.direct_path,
    fileSha256: sha256,
    fileLength: buffer.length,
    width: media.width || undefined,
    height: media.height || undefined,
    seconds: media.seconds || undefined,
    jpegThumbnail: media.jpegThumbnail || undefined,
    thumbnailDirectPath: thumb.thumbnail_direct_path || undefined,
    thumbnailSha256: thumb.thumbnail_sha256 ? Buffer.from(thumb.thumbnail_sha256, "base64") : undefined,
    contextInfo: media.contextInfo || undefined,
  };
  const message = baileys.proto.Message.fromObject({ [kind]: content });
  const msgId = (opts && opts.messageId) || baileys.generateMessageIDV2(sock.user && sock.user.id);
  const stanza = {
    tag: "message",
    attrs: { to: jid, id: msgId, type: "media", ...(json.handle ? { media_id: json.handle } : {}) },
    content: [{ tag: "plaintext", attrs: { mediatype: mediaType }, content: baileys.encodeNewsletterMessage(message) }],
  };
  await sock.sendNode(stanza);
  console.log(`${TAG} ${mediaType} sent to ${jid} (${buffer.length} bytes, ${json.handle ? "with" : "without"} handle)`);
  const sent = baileys.generateWAMessageFromContent(jid, message, { userJid: sock.user && sock.user.id, messageId: msgId });
  sent.key = { remoteJid: jid, fromMe: true, id: msgId };
  return sent;
}

/** Wraps a socket's sendMessage for channel media. Exported for tests. */
function patchSocket(baileys, sock, fetchImpl = fetch) {
  if (!sock || typeof sock.sendMessage !== "function" || sock.__newsletterMediaPatched) return sock;
  const original = sock.sendMessage;
  sock.sendMessage = async function (jid, content, opts) {
    const message = isNewsletter(jid) && content && content.forward && content.forward.message;
    const kind = message && Object.keys(KINDS).find((k) => message[k] && message[k].mediaKey);
    if (kind) {
      try {
        return await sendNewsletterMedia(baileys, sock, jid, kind, message[kind], opts, fetchImpl);
      } catch (error) {
        const reason = error && error.message ? error.message : String(error);
        console.error(`${TAG} failed: ${reason}`);
        throw new Error(`channel ${KINDS[kind]} failed: ${reason}`);
      }
    }
    return original.apply(this, arguments);
  };
  Object.defineProperty(sock, "__newsletterMediaPatched", { value: true });
  return sock;
}

/** A copy of the module namespace whose makeWASocket returns patched sockets. Exported for tests. */
function wrapBaileys(ns) {
  const make = typeof ns.default === "function" ? ns.default : ns.makeWASocket;
  if (typeof make !== "function") return ns;
  const out = {};
  for (const key of Reflect.ownKeys(ns)) {
    try {
      out[key] = ns[key];
    } catch {}
  }
  const patched = function makeWASocket(config) {
    return patchSocket(ns, make(config));
  };
  out.default = patched;
  out.makeWASocket = patched;
  Object.defineProperty(out, "__esModule", { value: true });
  return out;
}

if (!process.env.NEWSLETTER_MEDIA_PATCH_DISABLED && !globalThis.__newsletterMediaHooked) {
  globalThis.__newsletterMediaHooked = true;
  const load = Module._load;
  let wrapped;
  Module._load = function (request) {
    const mod = load.apply(this, arguments);
    if (request !== "baileys") return mod;
    if (!wrapped) {
      wrapped = wrapBaileys(mod);
      console.log(`${TAG} active: photos/videos to channels use the channel upload path`);
    }
    return wrapped;
  };
}

module.exports = { patchSocket, wrapBaileys, uploadForNewsletter };
