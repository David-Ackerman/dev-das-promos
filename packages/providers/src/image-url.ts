const DEMO_IMAGE_HOST = "images.example.com";

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Keep browser-loaded product images on HTTPS marketplace CDN hosts. */
export function sanitizeMarketplaceImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowedHost =
    host === DEMO_IMAGE_HOST ||
    hostMatches(host, "media-amazon.com") ||
    hostMatches(host, "susercontent.com") ||
    host === "cf.shopee.com.br" ||
    hostMatches(host, "mlstatic.com");

  if (!allowedHost || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (url.username || url.password || url.port) return null;

  // Mercado Livre still returns http:// URLs from its official image CDN.
  // Upgrade only that already-allowlisted host before sending it to browsers.
  url.protocol = "https:";
  return url.toString();
}
