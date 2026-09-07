import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopeeBrazilProvider, ShopeeOpenApiProvider, createShopeeProvider } from "../shopee-br.js";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as Response;
}

const PRODUCT_OFFER_RESPONSE = {
  data: {
    productOfferV2: {
      nodes: [
        {
          itemId: 1234567890,
          productName: "Fone de Ouvido Bluetooth XYZ",
          productLink: "https://shopee.com.br/product/111/1234567890",
          offerLink: "https://shopee.com.br/product/111/1234567890?af_id=app-affiliate",
          imageUrl: "https://cf.shopee.com.br/file/xyz.jpg",
          priceMin: "129.90",
          priceMax: "199.90",
          priceDiscountRate: 35,
          sales: 4200,
          ratingStar: 4.8,
          commissionRate: "0.08",
          sellerCommissionRate: "0.05",
          shopeeCommissionRate: "0.03",
          commission: "10.39",
          shopId: 111,
          shopName: "XYZ Official Store",
          shopType: 1,
          periodStartTime: 1735689600,
          periodEndTime: 1738368000,
        },
      ],
      pageInfo: { page: 1, limit: 20, hasNextPage: false },
    },
  },
};

const SHORT_LINK_RESPONSE = {
  data: {
    generateShortLink: { shortLink: "https://shope.ee/abc123xyz" },
  },
};

const RATE_LIMIT_ERROR_RESPONSE = {
  errors: [
    {
      message: "Rate limit exceeded",
      path: ["productOfferV2"],
      extensions: { code: 10030, message: "Too many requests, slow down" },
    },
  ],
};

const AUTH_ERROR_RESPONSE = {
  errors: [
    {
      message: "Invalid signature",
      path: ["productOfferV2"],
      extensions: { code: 10020, message: "Invalid Signature" },
    },
  ],
};

describe("ShopeeOpenApiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeProvider() {
    return new ShopeeOpenApiProvider({
      appId: "test-app-id",
      appSecret: "test-app-secret",
      affiliateId: "dasdeals",
    });
  }

  it("reports its marketplace", () => {
    expect(makeProvider().marketplace).toBe("shopee_br");
  });

  it("signs requests with the documented Authorization header format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PRODUCT_OFFER_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await makeProvider().fetchOffers({ limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://open-api.affiliate.shopee.com.br/graphql");
    expect(init.method).toBe("POST");
    const authHeader = init.headers.authorization as string;
    expect(authHeader).toMatch(
      /^SHA256 Credential=test-app-id, Timestamp=\d+, Signature=[0-9a-f]{64}$/,
    );
  });

  it("fetches and maps offers, converting price strings to integer cents without float drift", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PRODUCT_OFFER_RESPONSE)));

    const offers = await makeProvider().fetchOffers({ limit: 5 });

    expect(offers).toHaveLength(1);
    const offer = offers[0]!;
    expect(offer.externalId).toBe("1234567890");
    expect(offer.productName).toBe("Fone de Ouvido Bluetooth XYZ");
    expect(offer.priceCents).toBe(12990);
    expect(Number.isInteger(offer.priceCents)).toBe(true);
    expect(offer.currency).toBe("BRL");
    expect(offer.availability).toBe("unknown");
    expect(offer.sellerName).toBe("XYZ Official Store");
    // priceDiscountRate of 35 derives the original price from priceMin.
    expect(offer.originalPriceCents).toBe(Math.round(12990 / (1 - 35 / 100)));
    // commission ("10.39") is the only per-offer monetary field available.
    expect(offer.couponValueCents).toBe(1039);
    // No clean 0-100 equivalent for rating/sales -> both omitted.
    expect(offer.sellerRating).toBeUndefined();
    expect(offer.popularityScore).toBeUndefined();
  });

  it("looks up a single product by external id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PRODUCT_OFFER_RESPONSE)));

    const product = await makeProvider().getProduct("1234567890");

    expect(product).not.toBeNull();
    expect(product?.externalId).toBe("1234567890");
    expect(product?.productName).toBe("Fone de Ouvido Bluetooth XYZ");
    expect(product?.url).toBe("https://shopee.com.br/product/111/1234567890?af_id=app-affiliate");
  });

  it("returns null when the product search comes back empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            productOfferV2: { nodes: [], pageInfo: { page: 1, limit: 1, hasNextPage: false } },
          },
        }),
      ),
    );

    const product = await makeProvider().getProduct("999");
    expect(product).toBeNull();
  });

  it("builds an affiliate url via the generateShortLink mutation, forwarding subIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SHORT_LINK_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    const provider = makeProvider();
    const url = await provider.buildAffiliateUrl(
      { externalId: "1", productName: "x", url: "https://shopee.com.br/product/1" },
      { subId: "click-1", campaign: "telegram-launch" },
    );

    expect(url).toBe("https://shope.ee/abc123xyz");
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain("generateShortLink");
    expect(body.variables.input.originUrl).toBe("https://shopee.com.br/product/1");
    expect(body.variables.input.subIds).toEqual(["click-1", "telegram-launch"]);
  });

  it("throws a clear error on a GraphQL error response instead of swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(AUTH_ERROR_RESPONSE)));

    await expect(makeProvider().fetchOffers()).rejects.toThrow(/Invalid Signature/);
  });

  it("throws a clear error on a non-2xx HTTP response with no GraphQL errors array", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({}, { status: 500, statusText: "Internal Server Error" })),
    );

    await expect(makeProvider().fetchOffers()).rejects.toThrow(/HTTP 500/);
  });

  it("retries with backoff on rate-limit errors and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(RATE_LIMIT_ERROR_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(RATE_LIMIT_ERROR_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_OFFER_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    const offers = await makeProvider().fetchOffers();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(offers).toHaveLength(1);
  });

  it("gives up after exhausting retries on persistent rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(RATE_LIMIT_ERROR_RESPONSE)));
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    await expect(makeProvider().fetchOffers()).rejects.toThrow(
      /Rate limit exceeded|Too many requests/,
    );
  });
});

describe("createShopeeProvider", () => {
  it("returns the real ShopeeOpenApiProvider when both appId and appSecret are present", () => {
    const provider = createShopeeProvider({
      appId: "app-1",
      appSecret: "secret-1",
      affiliateId: "dasdeals",
    });
    expect(provider).toBeInstanceOf(ShopeeOpenApiProvider);
  });

  it("falls back to the mock ShopeeBrazilProvider when appId is missing", () => {
    const provider = createShopeeProvider({ appSecret: "secret-1", affiliateId: "dasdeals" });
    expect(provider).toBeInstanceOf(ShopeeBrazilProvider);
  });

  it("falls back to the mock ShopeeBrazilProvider when appSecret is missing", () => {
    const provider = createShopeeProvider({ appId: "app-1", affiliateId: "dasdeals" });
    expect(provider).toBeInstanceOf(ShopeeBrazilProvider);
  });

  it("falls back to the mock ShopeeBrazilProvider when no credentials are passed at all", () => {
    const provider = createShopeeProvider();
    expect(provider).toBeInstanceOf(ShopeeBrazilProvider);
  });
});
