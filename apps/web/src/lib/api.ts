const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

/**
 * Public site fetch helper. Uses Next.js's fetch cache with a short
 * revalidate window instead of no-store: deal pages should be fast and
 * cacheable for SEO/crawler traffic, but still reflect price/score
 * changes within a minute rather than serving stale data indefinitely.
 */
export async function apiGet<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  const response = await fetch(`${API_URL}${path}`, {
    next: { revalidate: revalidateSeconds },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function apiGoUrl(code: string): string {
  return `${API_URL}/go/${code}`;
}
