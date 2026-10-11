import { SITE_URL } from "@/lib/api";
import { SITEMAP_URLS_PER_FILE, getSitemapPaths } from "@/lib/sitemap-data";
import { XML_CACHE_HEADERS, escapeXml } from "@/lib/xml";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sitemapId = id.endsWith(".xml") ? id.slice(0, -4) : id;
  if (!/^\d+$/.test(sitemapId)) {
    return new Response("Not found", { status: 404 });
  }
  const sitemapIndex = Number(sitemapId);
  if (!Number.isSafeInteger(sitemapIndex) || sitemapIndex < 0) {
    return new Response("Not found", { status: 404 });
  }

  const paths = await getSitemapPaths();
  const start = sitemapIndex * SITEMAP_URLS_PER_FILE;
  if (start >= paths.length) return new Response("Not found", { status: 404 });

  const urls = paths
    .slice(start, start + SITEMAP_URLS_PER_FILE)
    .map((path) => `<url><loc>${escapeXml(new URL(path, SITE_URL).toString())}</loc></url>`)
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: XML_CACHE_HEADERS },
  );
}
