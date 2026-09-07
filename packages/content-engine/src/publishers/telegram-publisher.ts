import type { PublicationPayload, PublicationResult, Publisher } from "../types.js";
import { MockPublisher } from "./mock-publisher.js";

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

/**
 * Real Telegram publisher using the Bot API's sendMessage. Requires a bot
 * token (from @BotFather) and a target chat/channel id -- see
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env.example. Startup must
 * never fail because these are missing: use `createTelegramPublisher`
 * below, which falls back to MockPublisher when credentials are absent.
 */
export class TelegramPublisher implements Publisher {
  readonly channel = "telegram" as const;

  constructor(private readonly credentials: TelegramCredentials) {}

  async publish(payload: PublicationPayload): Promise<PublicationResult> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.credentials.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: this.credentials.chatId,
            text: payload.content,
            disable_web_page_preview: false,
          }),
        },
      );

      const body = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };

      if (!response.ok || !body.ok) {
        return { status: "failed", errorMessage: body.description ?? `HTTP ${response.status}` };
      }

      return {
        status: "published",
        externalPublicationId: String(body.result?.message_id ?? ""),
        publishedAt: new Date(),
      };
    } catch (error) {
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function createTelegramPublisher(credentials?: Partial<TelegramCredentials>): Publisher {
  if (credentials?.botToken && credentials.chatId) {
    return new TelegramPublisher({ botToken: credentials.botToken, chatId: credentials.chatId });
  }
  return new MockPublisher("telegram");
}
