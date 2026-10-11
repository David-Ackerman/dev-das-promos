"use client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/** Browser fetch helper for client components (TanStack Query mutations). */
export async function apiFetchClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    let body: { error?: unknown; message?: unknown } | undefined;
    try {
      body = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
    } catch {
      // Keep the raw response available for non-JSON errors and proxies.
    }
    const detail =
      (typeof body?.error === "string" && body.error) ||
      (typeof body?.message === "string" && body.message);
    throw new Error(
      detail
        ? `${detail} (HTTP ${response.status})`
        : `Request to ${path} failed with ${response.status}: ${rawBody}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
