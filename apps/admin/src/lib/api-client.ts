"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
    const body = await response.text().catch(() => "");
    throw new Error(`Request to ${path} failed with ${response.status}: ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
