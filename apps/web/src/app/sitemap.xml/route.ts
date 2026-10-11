import { SITE_URL } from "@/lib/api";
import { SITEMAP_URLS_PER_FILE, getSitemapPaths } from "@/lib/sitemap-data";
import { XML_CACHE_HEADERS, escapeXml } from "@/lib/xml";

export const dynamic = "force-dynamic";

export async function GET() {
  const paths = await getSitemapPaths();
  const sitemapCount = Math.max(1, Math.ceil(paths.length / SITEMAP_URLS_PER_FILE));
  const locations = Array.from({ length: sitemapCount }, (_, id) => {
    const url = new URL(`/sitemaps/${id}.xml`, SITE_URL).toString();
    return `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`;
  }).join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</sitemapindex>`,
    { headers: XML_CACHE_HEADERS },
  );
}
