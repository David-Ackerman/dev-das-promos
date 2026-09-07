import "server-only";
import { redirect } from "next/navigation";
import { ApiAuthError, apiFetchServer } from "./api-server.js";

export interface CurrentAdmin {
  id: string;
  email: string;
  name: string | null;
}

/** Call at the top of any protected Server Component page. Redirects to /login when not authenticated. */
export async function requireAdmin(): Promise<CurrentAdmin> {
  try {
    return await apiFetchServer<CurrentAdmin>("/auth/me");
  } catch (error) {
    if (error instanceof ApiAuthError) {
      redirect("/login");
    }
    throw error;
  }
}
