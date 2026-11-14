import type { Config } from "../config.ts";

/**
 * WhatsApp delivery.
 *
 * The official WhatsApp Cloud API cannot post into regular community/promo
 * groups, so the default mode is "share": after you approve, the bot gives
 * you a one-tap button that opens WhatsApp with the post already written —
 * you just pick the group(s).
 *
 * "evolution" (self-hosted Evolution API) and "zapi" (Z-API, paid) automate
 * it through a linked WhatsApp number. Both are unofficial: WhatsApp may ban
 * numbers that look like spam, so use a dedicated number and keep volume low.
 */
type WA = Config["whatsapp"];

/** A WhatsApp Channel id ("120363…@newsletter"), not a group or a chat. */
export function isChannel(id: string): boolean {
  return id.trim().endsWith("@newsletter");
}

export function shareUrl(text: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`WhatsApp gateway HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

type Evolution = NonNullable<WA["evolution"]>;

/** The gateway lost its WhatsApp connection ("Connection Closed", 408…), as opposed to a bad message. */
export function isConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /connection (closed|lost)|not connected|connection.*(close|terminated)|instance.*(close|not.*open)/i.test(msg);
}

async function evolutionState(evo: Evolution): Promise<string> {
  const res = await fetch(`${evo.baseUrl}/instance/connectionState/${evo.instance}`, {
    headers: { apikey: evo.apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { instance?: { state?: string } };
  return json.instance?.state ?? `HTTP ${res.status}`;
}

/** What `/manager` needs: a new QR code scan. */
export function relinkMessage(evo: Evolution): string {
  return `WhatsApp desconectado do servidor: abra ${evo.baseUrl}/manager → promos → Get QR Code e escaneie no WhatsApp Business (Dispositivos conectados).`;
}

/**
 * Makes sure Evolution is connected to WhatsApp: when it isn't, asks it to
 * reconnect with the saved session and waits up to `waitMs`. Returns "open",
 * or the state it got stuck in ("connecting" = it wants a new QR code scan).
 * Sleeps go through `wait` so tests don't wait for real.
 */
export async function ensureWhatsAppConnected(
  wa: WA,
  opts: { waitMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const evo = wa.evolution;
  if (wa.mode !== "evolution" || !evo) return "open";
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if ((await evolutionState(evo)) === "open") return "open";
  await fetch(`${evo.baseUrl}/instance/connect/${evo.instance}`, { headers: { apikey: evo.apiKey }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  let state = "close";
  for (let waited = 0; waited < (opts.waitMs ?? 9_000); waited += 1_500) {
    await wait(1_500);
    state = await evolutionState(evo).catch(() => "unreachable");
    if (state === "open") break;
  }
  return state;
}

/**
 * Sends to one group/channel. Through Evolution, a lost WhatsApp connection gets
 * one reconnect attempt and one retry; if it needs a new QR code, the error says how.
 */
export async function sendWhatsApp(
  wa: WA,
  groupId: string,
  text: string,
  imageUrl?: string | null,
  opts: { wait?: (ms: number) => Promise<void> } = {},
): Promise<string | undefined> {
  try {
    return await sendOnce(wa, groupId, text, imageUrl);
  } catch (error) {
    if (wa.mode !== "evolution" || !wa.evolution || !isConnectionError(error)) throw error;
    const state = await ensureWhatsAppConnected(wa, { wait: opts.wait });
    if (state !== "open") throw new Error(relinkMessage(wa.evolution));
    return await sendOnce(wa, groupId, text, imageUrl);
  }
}

/** Sends to one group via the configured gateway. Returns the gateway's message id when available. */
async function sendOnce(
  wa: WA,
  groupId: string,
  text: string,
  imageUrl?: string | null,
): Promise<string | undefined> {
  if (wa.mode === "evolution" && wa.evolution) {
    const { baseUrl, apiKey, instance } = wa.evolution;
    // Channels (@newsletter) always get text: WhatsApp silently drops photo posts sent to a
    // channel this way (the server answers 201 but they never show up), while text with the
    // link goes through and WhatsApp's link preview brings the product photo.
    if (imageUrl && !isChannel(groupId)) {
      const json = await postJson(`${baseUrl}/message/sendMedia/${instance}`, { apikey: apiKey }, {
        number: groupId,
        mediatype: "image",
        media: imageUrl,
        caption: text,
      });
      return (json.key as { id?: string } | undefined)?.id;
    }
    const json = await postJson(`${baseUrl}/message/sendText/${instance}`, { apikey: apiKey }, {
      number: groupId,
      text,
      linkPreview: true,
    });
    return (json.key as { id?: string } | undefined)?.id;
  }
  if (wa.mode === "zapi" && wa.zapi) {
    const { instanceId, token, clientToken } = wa.zapi;
    const base = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
    const json = imageUrl
      ? await postJson(`${base}/send-image`, { "Client-Token": clientToken }, {
          phone: groupId,
          image: imageUrl,
          caption: text,
        })
      : await postJson(`${base}/send-text`, { "Client-Token": clientToken }, {
          phone: groupId,
          message: text,
        });
    return (json.messageId ?? json.zaapId) as string | undefined;
  }
  throw new Error(`WhatsApp mode "${wa.mode}" cannot send automatically`);
}
