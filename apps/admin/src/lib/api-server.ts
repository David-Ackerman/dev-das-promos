import "server-only";
import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Server Component fetch helper: forwards the incoming browser's cookies
 * to the API so the admin session cookie authenticates the server-to-
 * server call too. Never cache admin data by default -- it's operator
 * data that must always be fresh.
 */
export async function apiFetchServer<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie: cookieHeader,
      "content-type": "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new ApiAuthError();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API request to ${path} failed with ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

export class ApiAuthError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "ApiAuthError";
  }
}
