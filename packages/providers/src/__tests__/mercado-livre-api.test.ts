import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MercadoLivreApiProvider,
  MercadoLivreProvider,
  createMercadoLivreProvider,
} from "../mercado-livre.js";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as Response;
}

const TOKEN_RESPONSE = {
  access_token: "APP_USR-access-token-1",
  token_type: "bearer",
  expires_in: 21_600,
  scope: "offline_access read write",
  user_id: 123456789,
  refresh_token: "TG-refresh-token-rotated-1",
};

const SEARCH_RESPONSE = {
  results: [
    {
      id: "MLB1234567890",
      title: "Mouse Gamer RGB 16000 DPI",
      price: 159.9,
      original_price: 199.9,
      currency_id: "BRL",
      thumbnail: "https://http2.mlstatic.com/D_1234-mouse.jpg",
      permalink: "https://produto.mercadolivre.com.br/MLB-1234567890",
      category_id: "MLB1000",
      available_quantity: 12,
      sold_quantity: 340,
      condition: "new",
      status: "active",
      shipping: { free_shipping: true },
      seller: {
        id: 55,
        nickname: "REDRAGON OFICIAL",
        seller_reputation: { level_id: "5_green", power_seller_status: "platinum" },
      },
    },
  ],
};

const ITEM_RESPONSE = {
  id: "MLB1234567890",
  title: "Mouse Gamer RGB 16000 DPI",
  price: 159.9,
  original_price: 199.9,
  currency_id: "BRL",
  thumbnail: "https://http2.mlstatic.com/D_1234-mouse.jpg",
  permalink: "https://produto.mercadolivre.com.br/MLB-1234567890",
  category_id: "MLB1000",
  available_quantity: 12,
  condition: "new",
  status: "active",
  shipping: { free_shipping: true },
  seller_id: 55,
};

const USER_RESPONSE = {
  id: 55,
  nickname: "REDRAGON OFICIAL",
  seller_reputation: { level_id: "4_light_green", power_seller_status: "gold" },
};

const INVALID_GRANT_RESPONSE = {
  message:
    "Error validating grant. Your authorization code or refresh token may be expired or it was already used",
  error: "invalid_grant",
  status: 400,
  cause: [],
};

describe("MercadoLivreApiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeProvider() {
    return new MercadoLivreApiProvider(
      "test-app-id",
      "test-client-secret",
      "TG-initial-refresh-token",
      "dasdeals",
    );
  }

  it("reports its marketplace", () => {
    expect(makeProvider().marketplace).toBe("mercado_livre");
  });

  it("exchanges the refresh token for an access token before the first request", async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(init?.body as string);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("client_id")).toBe("test-app-id");
        expect(body.get("client_secret")).toBe("test-client-secret");
        expect(body.get("refresh_token")).toBe("TG-initial-refresh-token");
        return jsonResponse(TOKEN_RESPONSE);
      }
      if (url.includes("/sites/MLB/search")) {
        expect((init?.headers as Record<string, string>).authorization).toBe(
          "Bearer APP_USR-access-token-1",
        );
        return jsonResponse(SEARCH_RESPONSE);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = makeProvider();
    await provider.fetchOffers({ limit: 10 });

    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/oauth/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("caches the access token across calls and re-mints only after it expires", async () => {
    let tokenCallCount = 0;
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        tokenCallCount += 1;
        return jsonResponse({
          ...TOKEN_RESPONSE,
          expires_in: 300,
          access_token: `token-${tokenCallCount}`,
        });
      }
      if (url.includes("/sites/MLB/search")) {
        return jsonResponse(SEARCH_RESPONSE);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = makeProvider();

    await provider.fetchOffers({ limit: 1 });
    await provider.fetchOffers({ limit: 1 });
    expect(tokenCallCount).toBe(1); // second call reused the cached token

    // Simulate the cached token being past its 300s expiry (well beyond the 60s safety margin).
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 400_000);
    await provider.fetchOffers({ limit: 1 });
    expect(tokenCallCount).toBe(2); // re-minted once expired
  });

  it("caches a rotated refresh token in-process and reuses it on the next refresh", async () => {
    const refreshTokensSeen: string[] = [];
    let tokenCallCount = 0;
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        tokenCallCount += 1;
        const body = new URLSearchParams(init?.body as string);
        refreshTokensSeen.push(body.get("refresh_token") ?? "");
        return jsonResponse({
          ...TOKEN_RESPONSE,
          expires_in: 1,
          access_token: `token-${tokenCallCount}`,
          refresh_token: `TG-rotated-${tokenCallCount}`,
        });
      }
      if (url.includes("/sites/MLB/search")) {
        return jsonResponse(SEARCH_RESPONSE);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = makeProvider();
    await provider.fetchOffers({ limit: 1 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    await provider.fetchOffers({ limit: 1 });

    expect(refreshTokensSeen).toEqual(["TG-initial-refresh-token", "TG-rotated-1"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("maps a search result to a MarketplaceOfferData with price in integer cents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("/oauth/token")) return jsonResponse(TOKEN_RESPONSE);
        if (url.includes("/sites/MLB/search")) return jsonResponse(SEARCH_RESPONSE);
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const provider = makeProvider();
    const [offer] = await provider.fetchOffers({ limit: 10 });

    expect(offer).toBeDefined();
    expect(offer?.externalId).toBe("MLB1234567890");
    expect(offer?.priceCents).toBe(15_990);
    expect(offer?.originalPriceCents).toBe(19_990);
    expect(offer?.currency).toBe("BRL");
    expect(offer?.availability).toBe("in_stock");
    expect(offer?.shippingPriceCents).toBe(0);
    expect(offer?.sellerName).toBe("REDRAGON OFICIAL");
    expect(offer?.sellerRating).toBe(100); // 5_green
  });

  it("sends category and limit through to the search request", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = new URL(String(input));
      if (url.pathname === "/oauth/token") return jsonResponse(TOKEN_RESPONSE);
      if (url.pathname === "/sites/MLB/search") {
        expect(url.searchParams.get("category")).toBe("MLB1000");
        expect(url.searchParams.get("limit")).toBe("5");
        return jsonResponse(SEARCH_RESPONSE);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = makeProvider();
    await provider.fetchOffers({ category: "MLB1000", limit: 5 });
  });

  it("fetches a single product by external id, including seller rating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("/oauth/token")) return jsonResponse(TOKEN_RESPONSE);
        if (url.includes("/items/MLB1234567890")) return jsonResponse(ITEM_RESPONSE);
        if (url.includes("/users/55")) return jsonResponse(USER_RESPONSE);
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const provider = makeProvider();
    const product = await provider.getProduct("MLB1234567890");

    expect(product).not.toBeNull();
    expect(product?.productName).toBe("Mouse Gamer RGB 16000 DPI");
    expect(product?.url).toBe("https://produto.mercadolivre.com.br/MLB-1234567890");
    expect(product?.sellerRating).toBe(80); // 4_light_green
  });

  it("returns null when the item lookup 404s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("/oauth/token")) return jsonResponse(TOKEN_RESPONSE);
        if (url.includes("/items/")) {
          return jsonResponse(
            { message: "Item not found", error: "not_found", status: 404 },
            { status: 404 },
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const provider = makeProvider();
    const product = await provider.getProduct("MLB0000000000");
    expect(product).toBeNull();
  });

  it("throws a clear, unrecoverable-setup error when the refresh token is invalid/expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(INVALID_GRANT_RESPONSE, { status: 400 })),
    );

    const provider = makeProvider();
    await expect(provider.fetchOffers()).rejects.toThrow(/invalid or expired/i);
    await expect(provider.fetchOffers()).rejects.toThrow(/manual OAuth authorization flow/i);
  });

  it("retries on a 429 rate-limit response and eventually succeeds", async () => {
    let searchAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("/oauth/token")) return jsonResponse(TOKEN_RESPONSE);
        if (url.includes("/sites/MLB/search")) {
          searchAttempts += 1;
          if (searchAttempts < 3) {
            return jsonResponse({ message: "Too many requests" }, { status: 429 });
          }
          return jsonResponse(SEARCH_RESPONSE);
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const provider = makeProvider();
    const offers = await provider.fetchOffers({ limit: 1 });
    expect(searchAttempts).toBe(3);
    expect(offers).toHaveLength(1);
  }, 10_000);

  it("throws instead of fabricating an affiliate link (no official ML API for this exists)", async () => {
    const provider = makeProvider();
    await expect(
      provider.buildAffiliateUrl({
        externalId: "MLB1234567890",
        productName: "Mouse Gamer",
        url: "https://produto.mercadolivre.com.br/MLB-1234567890",
      }),
    ).rejects.toThrow(/no public API|Affiliate Portal/i);
  });
});

describe("createMercadoLivreProvider", () => {
  it("returns the mock provider when credentials are absent", () => {
    const provider = createMercadoLivreProvider({ affiliateId: "dasdeals" });
    expect(provider).toBeInstanceOf(MercadoLivreProvider);
  });

  it("returns the mock provider when credentials are only partially present", () => {
    const provider = createMercadoLivreProvider({ appId: "id-only", affiliateId: "dasdeals" });
    expect(provider).toBeInstanceOf(MercadoLivreProvider);
  });

  it("returns the real API provider when all three credentials are present", () => {
    const provider = createMercadoLivreProvider({
      appId: "test-app-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh",
      affiliateId: "dasdeals",
    });
    expect(provider).toBeInstanceOf(MercadoLivreApiProvider);
  });
});
