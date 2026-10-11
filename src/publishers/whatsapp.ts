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

/** Sends to one group via the configured gateway. Returns the gateway's message id when available. */
export async function sendWhatsApp(
  wa: WA,
  groupId: string,
  text: string,
  imageUrl?: string | null,
): Promise<string | undefined> {
  if (wa.mode === "evolution" && wa.evolution) {
    const { baseUrl, apiKey, instance } = wa.evolution;
    const json = imageUrl
      ? await postJson(`${baseUrl}/message/sendMedia/${instance}`, { apikey: apiKey }, {
          number: groupId,
          mediatype: "image",
          media: imageUrl,
          caption: text,
        })
      : await postJson(`${baseUrl}/message/sendText/${instance}`, { apikey: apiKey }, {
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
