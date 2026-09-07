import { createHmac, randomBytes } from "node:crypto";
import { DEFAULT_CONTENT_LIMITS } from "../limits.js";
import type { PublicationPayload, PublicationResult, Publisher } from "../types.js";
import { MockPublisher } from "./mock-publisher.js";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

const TWEETS_URL = "https://api.x.com/2/tweets";

/**
 * RFC 3986 percent-encoding, as required by the OAuth 1.0a spec. This is
 * stricter than `encodeURIComponent` -- it also escapes `! * ' ( )`, which
 * `encodeURIComponent` leaves alone -- so every value going into the
 * signature base string or the Authorization header must go through this,
 * not the builtin.
 */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds the `Authorization: OAuth ...` header for a single request using
 * OAuth 1.0a user-context signing (HMAC-SHA1). `POST /2/tweets` takes no
 * query/body-form parameters that participate in signing (the body is
 * JSON, not `application/x-www-form-urlencoded`), so the signature base
 * string's parameter set is exactly the oauth_* parameters themselves.
 */
function buildAuthorizationHeader(method: string, url: string, credentials: XCredentials): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key] as string)}`)
    .join("&");

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join(
    "&",
  );

  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };

  const headerString = Object.keys(headerParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key] as string)}"`)
    .join(", ");

  return `OAuth ${headerString}`;
}

interface XSuccessBody {
  data?: { id: string; text: string };
}

interface XErrorBody {
  errors?: { message?: string; title?: string; detail?: string }[];
  title?: string;
  detail?: string;
}

function extractErrorMessage(status: number, body: unknown): string {
  const errorBody = body as XErrorBody | undefined;
  if (errorBody?.errors?.length) {
    const messages = errorBody.errors
      .map((error) => error.detail ?? error.message ?? error.title)
      .filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join("; ");
  }
  if (errorBody?.detail) return errorBody.detail;
  if (errorBody?.title) return errorBody.title;
  return `HTTP ${status}`;
}

/**
 * Real X/Twitter publisher. Signs each request with OAuth 1.0a user
 * context (HMAC-SHA1, via node:crypto -- no external OAuth1 dependency)
 * and posts to the v2 `POST /2/tweets` endpoint. `payload.content` is
 * expected to already respect X's character limit (see
 * DEFAULT_CONTENT_LIMITS.x / packages/content-engine/src/limits.ts) by
 * the time it reaches this publisher; this class defensively truncates
 * as a last resort rather than relying solely on the caller.
 */
export class XPublisher implements Publisher {
  readonly channel = "x" as const;

  constructor(private readonly credentials: XCredentials) {}

  async publish(payload: PublicationPayload): Promise<PublicationResult> {
    const limit = DEFAULT_CONTENT_LIMITS.x;
    const text =
      payload.content.length > limit ? `${payload.content.slice(0, limit - 1)}…` : payload.content;

    try {
      const authorization = buildAuthorizationHeader("POST", TWEETS_URL, this.credentials);

      const response = await fetch(TWEETS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization,
        },
        body: JSON.stringify({ text }),
      });

      const body = (await response.json()) as XSuccessBody & XErrorBody;

      if (!response.ok || !body.data?.id) {
        return { status: "failed", errorMessage: extractErrorMessage(response.status, body) };
      }

      return {
        status: "published",
        externalPublicationId: body.data.id,
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

export function createXPublisher(credentials?: Partial<XCredentials>): Publisher {
  if (
    credentials?.apiKey &&
    credentials.apiSecret &&
    credentials.accessToken &&
    credentials.accessTokenSecret
  ) {
    return new XPublisher({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      accessToken: credentials.accessToken,
      accessTokenSecret: credentials.accessTokenSecret,
    });
  }
  return new MockPublisher("x");
}
