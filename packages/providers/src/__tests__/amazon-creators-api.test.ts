import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmazonBrazilProvider,
  AmazonCreatorsApiProvider,
  createAmazonProvider,
} from "../amazon-br.js";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as Response;
}

const TOKEN_RESPONSE = { access_token: "test-token-1", expires_in: 3600 };

// Shapes taken from Amazon's own Creators API docs (searchItems full
// request/response example, offersV2 resource reference).
const SEARCH_ITEMS_RESPONSE = {
  searchResult: {
    items: [
      {
        asin: "B0C1EXAMPLE",
        itemInfo: {
          title: { displayValue: "Fone de Ouvido Bluetooth XYZ" },
          byLineInfo: { brand: { displayValue: "XYZ Brand" } },
        },
        images: { primary: { large: { url: "https://m.media-amazon.com/images/I/example.jpg" } } },
        offersV2: {
          listings: [
            {
              price: {
                money: { amount: 129.9, currency: "BRL", displayAmount: "R$ 129,90" },
                savingBasis: {
                  money: { amount: 199.9, currency: "BRL", displayAmount: "R$ 199,90" },
                },
              },
              availability: { type: "IN_STOCK", message: "In Stock" },
              merchantInfo: { name: "Amazon.com.br" },
            },
          ],
        },
      },
    ],
    totalResultCount: 1,
  },
};

const GET_ITEMS_RESPONSE = {
  itemsResult: {
    items: [
      {
        asin: "B0C1EXAMPLE",
        itemInfo: {
          title: { displayValue: "Fone de Ouvido Bluetooth XYZ" },
          byLineInfo: { brand: { displayValue: "XYZ Brand" } },
        },
        images: { primary: { large: { url: "https://m.media-amazon.com/images/I/example.jpg" } } },
        offersV2: {
          listings: [
            {
              price: { money: { amount: 129.9, currency: "BRL" } },
              availability: { type: "IN_STOCK_SCARCE", message: "Only 3 left" },
              merchantInfo: { name: "Amazon.com.br" },
            },
          ],
        },
      },
    ],
  },
};

const RATE_LIMITED_RESPONSE = { errors: [{ code: "TooManyRequests", message: "Throttled" }] };
const NOT_FOUND_RESPONSE = { itemsResult: { items: [] } };

function makeProvider() {
  return new AmazonCreatorsApiProvider({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    affiliateTag: "dasdeals-20",
  });
}

/** Stubs fetch: the first call (token) always succeeds, subsequent calls use `apiHandler`. */
function stubFetchWithToken(apiHandler: (input: unknown, init?: unknown) => unknown) {
  const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
    if (String(input) === "https://api.amazon.com/auth/o2/token") {
      return jsonResponse(TOKEN_RESPONSE);
    }
    return apiHandler(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AmazonCreatorsApiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports its marketplace", () => {
    expect(makeProvider().marketplace).toBe("amazon_br");
  });

  it("fetches an OAuth2 token via client_credentials and reuses it across calls", async () => {
    const fetchMock = stubFetchWithToken(() => jsonResponse(SEARCH_ITEMS_RESPONSE));

    const provider = makeProvider();
    await provider.fetchOffers({ limit: 1 });
    await provider.fetchOffers({ limit: 1 });

    const tokenCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === "https://api.amazon.com/auth/o2/token",
    );
    expect(tokenCalls).toHaveLength(1); // cached, not re-fetched on the second call

    const [, tokenInit] = tokenCalls[0] as [string, RequestInit];
    const tokenBody = JSON.parse(tokenInit.body as string);
    expect(tokenBody).toMatchObject({
      grant_type: "client_credentials",
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      scope: "creatorsapi::default",
    });
  });

  it("sends the bearer token, marketplace header, and partner tag on searchItems", async () => {
    const fetchMock = stubFetchWithToken((input, init) => {
      expect(String(input)).toBe("https://creatorsapi.amazon/catalog/v1/searchItems");
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-token-1");
      expect(headers["x-marketplace"]).toBe("www.amazon.com.br");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.partnerTag).toBe("dasdeals-20");
      expect(body.marketplace).toBe("www.amazon.com.br");
      return jsonResponse(SEARCH_ITEMS_RESPONSE);
    });

    await makeProvider().fetchOffers({ limit: 1 });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("maps a searchItems result to MarketplaceOfferData with price in integer cents", async () => {
    stubFetchWithToken(() => jsonResponse(SEARCH_ITEMS_RESPONSE));

    const [offer] = await makeProvider().fetchOffers({ limit: 1 });

    expect(offer).toBeDefined();
    expect(offer?.externalId).toBe("B0C1EXAMPLE");
    expect(offer?.productName).toBe("Fone de Ouvido Bluetooth XYZ");
    expect(offer?.brand).toBe("XYZ Brand");
    expect(offer?.imageUrl).toBe("https://m.media-amazon.com/images/I/example.jpg");
    expect(offer?.url).toBe("https://www.amazon.com.br/dp/B0C1EXAMPLE");
    expect(offer?.sellerName).toBe("Amazon.com.br");
    expect(offer?.priceCents).toBe(12_990);
    expect(offer?.originalPriceCents).toBe(19_990);
    expect(offer?.currency).toBe("BRL");
    expect(offer?.availability).toBe("in_stock");
    expect(offer?.sellerRating).toBeUndefined();
  });

  it("maps IN_STOCK_SCARCE to low_stock", async () => {
    stubFetchWithToken(() => jsonResponse(GET_ITEMS_RESPONSE));

    const product = await makeProvider().getProduct("B0C1EXAMPLE");
    expect(product?.productName).toBe("Fone de Ouvido Bluetooth XYZ");

    stubFetchWithToken(() =>
      jsonResponse({ searchResult: { items: GET_ITEMS_RESPONSE.itemsResult.items } }),
    );
    const [offer] = await makeProvider().fetchOffers({ limit: 1 });
    expect(offer?.availability).toBe("low_stock");
  });

  it("sends the category as keywords, and itemCount from limit", async () => {
    const fetchMock = stubFetchWithToken((_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.keywords).toBe("fones de ouvido");
      expect(body.itemCount).toBe(5);
      return jsonResponse(SEARCH_ITEMS_RESPONSE);
    });

    await makeProvider().fetchOffers({ category: "fones de ouvido", limit: 5 });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to a default keyword when no category is given", async () => {
    stubFetchWithToken((_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.keywords).toBe("ofertas");
      return jsonResponse(SEARCH_ITEMS_RESPONSE);
    });

    await makeProvider().fetchOffers();
  });

  it("paginates searchItems requests, capping itemCount at 10 per page", async () => {
    const pages: number[] = [];
    stubFetchWithToken((_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      pages.push(body.itemPage);
      expect(body.itemCount).toBeLessThanOrEqual(10);
      const items = Array.from({ length: body.itemCount }, (_, i) => ({
        ...SEARCH_ITEMS_RESPONSE.searchResult.items[0],
        asin: `B0PAGE${body.itemPage}ITEM${i}`,
      }));
      return jsonResponse({ searchResult: { items, totalResultCount: 100 } });
    });

    const offers = await makeProvider().fetchOffers({ limit: 25 });
    expect(offers).toHaveLength(25);
    expect(pages).toEqual([1, 2, 3]);
  });

  it("fetches a single product via getItems", async () => {
    const fetchMock = stubFetchWithToken((input, init) => {
      expect(String(input)).toBe("https://creatorsapi.amazon/catalog/v1/getItems");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.itemIds).toEqual(["B0C1EXAMPLE"]);
      expect(body.itemIdType).toBe("ASIN");
      return jsonResponse(GET_ITEMS_RESPONSE);
    });

    const product = await makeProvider().getProduct("B0C1EXAMPLE");
    expect(product?.externalId).toBe("B0C1EXAMPLE");
    expect(product?.brand).toBe("XYZ Brand");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("builds an affiliate url carrying the configured tag and campaign sub-tag", async () => {
    stubFetchWithToken(() => jsonResponse(GET_ITEMS_RESPONSE));

    const provider = makeProvider();
    const product = await provider.getProduct("B0C1EXAMPLE");
    const affiliateUrl = await provider.buildAffiliateUrl(product!, {
      campaign: "telegram-launch",
    });
    const parsed = new URL(affiliateUrl);
    expect(parsed.searchParams.get("tag")).toBe("dasdeals-20");
    expect(parsed.searchParams.get("ascsubtag")).toBe("telegram-launch");
  });

  it("throws a clear error when the token request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "invalid_client", error_description: "Bad credentials" },
          { status: 401 },
        ),
      ),
    );

    await expect(makeProvider().fetchOffers({ limit: 1 })).rejects.toThrow(/Bad credentials/);
  });

  it("throws a clear error including the code/message on an API error response", async () => {
    stubFetchWithToken(() =>
      jsonResponse(
        { errors: [{ code: "InvalidParameter", message: "Bad partnerTag" }] },
        { status: 400 },
      ),
    );

    await expect(makeProvider().fetchOffers({ limit: 1 })).rejects.toThrow(
      /InvalidParameter.*Bad partnerTag/,
    );
  });

  it("throws (does not return null) when getItems has no item", async () => {
    stubFetchWithToken(() => jsonResponse(NOT_FOUND_RESPONSE));

    await expect(makeProvider().getProduct("B0DOESNOTEXIST")).rejects.toThrow(/no item/);
  });

  it("retries on 429 with backoff and eventually succeeds", async () => {
    let attempts = 0;
    stubFetchWithToken(() => {
      attempts += 1;
      if (attempts < 3) return jsonResponse(RATE_LIMITED_RESPONSE, { status: 429 });
      return jsonResponse(SEARCH_ITEMS_RESPONSE);
    });

    const offers = await makeProvider().fetchOffers({ limit: 1 });
    expect(attempts).toBe(3);
    expect(offers).toHaveLength(1);
  }, 10_000);

  it("gives up after exhausting retries and throws", async () => {
    stubFetchWithToken(() => jsonResponse(RATE_LIMITED_RESPONSE, { status: 429 }));

    await expect(makeProvider().fetchOffers({ limit: 1 })).rejects.toThrow(/TooManyRequests/);
  }, 10_000);

  it("does not fabricate an offer for an item with no purchasable listing", async () => {
    stubFetchWithToken(() =>
      jsonResponse({
        searchResult: {
          items: [{ asin: "B0NOOFFER", itemInfo: { title: { displayValue: "No offers" } } }],
        },
      }),
    );

    const offers = await makeProvider().fetchOffers({ limit: 1 });
    expect(offers).toHaveLength(0);
  });
});

describe("createAmazonProvider", () => {
  it("returns the mock provider when no Creators API credentials are supplied", () => {
    expect(createAmazonProvider({ affiliateTag: "dasdeals-20" })).toBeInstanceOf(
      AmazonBrazilProvider,
    );
  });

  it("returns the mock provider when only one credential is supplied", () => {
    expect(
      createAmazonProvider({ affiliateTag: "dasdeals-20", creatorsClientId: "only-id" }),
    ).toBeInstanceOf(AmazonBrazilProvider);
  });

  it("returns the real Creators API provider when both credentials are supplied", () => {
    const provider = createAmazonProvider({
      affiliateTag: "dasdeals-20",
      creatorsClientId: "test-client-id",
      creatorsClientSecret: "test-client-secret",
    });
    expect(provider).toBeInstanceOf(AmazonCreatorsApiProvider);
    expect(provider.marketplace).toBe("amazon_br");
  });
});
