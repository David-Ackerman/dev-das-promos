import { describe, expect, it } from "vitest";
import { sanitizeMarketplaceImageUrl } from "../image-url.js";

describe("sanitizeMarketplaceImageUrl", () => {
  it.each([
    [
      "https://m.media-amazon.com/images/I/item.jpg",
      "https://m.media-amazon.com/images/I/item.jpg",
    ],
    ["https://cf.shopee.com.br/file/item.jpg", "https://cf.shopee.com.br/file/item.jpg"],
    ["http://http2.mlstatic.com/item.jpg", "https://http2.mlstatic.com/item.jpg"],
    [
      "https://down-br.img.susercontent.com/file/item.jpg",
      "https://down-br.img.susercontent.com/file/item.jpg",
    ],
  ] as const)("keeps approved marketplace CDN image %s", (url, expected) => {
    expect(sanitizeMarketplaceImageUrl(url)).toBe(expected);
  });

  it.each([
    "https://attacker.example/image.jpg",
    "https://www.shopee.com.br/product/123",
    "http://127.0.0.1/internal.png",
    "https://user:pass@m.media-amazon.com/image.jpg",
    "https://m.media-amazon.com:8443/image.jpg",
    "data:image/png;base64,AAAA",
  ])("rejects an untrusted image URL: %s", (url) => {
    expect(sanitizeMarketplaceImageUrl(url)).toBeNull();
  });
});
