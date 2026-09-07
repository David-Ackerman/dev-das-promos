import { seededInt } from "@dev-das-promos/providers";
import { hashIp } from "@dev-das-promos/shared";
import type { Database } from "../client.js";
import { clickEvents, redirects } from "../schema/index.js";

const REFERRERS_BY_CHANNEL: Record<string, string[]> = {
  telegram: ["https://t.me/dasdeals", "https://t.me/"],
  x: ["https://x.com/dasdeals", "https://t.co/"],
  web: ["https://www.google.com/", "https://www.google.com/search?q=promo", ""],
};

const USER_AGENT_SUMMARIES = [
  "mobile:chrome",
  "desktop:chrome",
  "mobile:safari",
  "desktop:firefox",
  "mobile:chrome",
];

const IP_HASH_SALT = "seed-demo-salt";

export async function seedClickEvents(db: Database): Promise<void> {
  const allRedirects = await db.select().from(redirects);

  for (const redirect of allRedirects) {
    const clickCount = seededInt(`clicks:${redirect.code}`, 2, 18);

    for (let i = 0; i < clickCount; i++) {
      const daysAgo = seededInt(`clicks:${redirect.code}:day:${i}`, 0, 13);
      const hoursOffset = seededInt(`clicks:${redirect.code}:hour:${i}`, 0, 23);
      const occurredAt = new Date();
      occurredAt.setDate(occurredAt.getDate() - daysAgo);
      occurredAt.setHours(hoursOffset, seededInt(`clicks:${redirect.code}:min:${i}`, 0, 59), 0, 0);

      const referrers = REFERRERS_BY_CHANNEL[redirect.channel ?? "web"] ?? [""];
      const referrer =
        referrers[seededInt(`clicks:${redirect.code}:ref:${i}`, 0, referrers.length - 1)];
      const uaSummary =
        USER_AGENT_SUMMARIES[
          seededInt(`clicks:${redirect.code}:ua:${i}`, 0, USER_AGENT_SUMMARIES.length - 1)
        ];
      const fakeIp = `203.0.${seededInt(`clicks:${redirect.code}:ipb:${i}`, 0, 255)}.${seededInt(`clicks:${redirect.code}:ipc:${i}`, 1, 254)}`;

      await db.insert(clickEvents).values({
        redirectId: redirect.id,
        dealCandidateId: redirect.dealCandidateId,
        channel: redirect.channel,
        campaign: redirect.campaign,
        source: redirect.source,
        referrer: referrer || undefined,
        userAgentSummary: uaSummary,
        ipHash: hashIp(fakeIp, IP_HASH_SALT),
        occurredAt,
      });
    }
  }
}
