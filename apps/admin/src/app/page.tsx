import { ApiAuthError, apiFetchServer } from "@/lib/api-server";
import { redirect } from "next/navigation";

export default async function RootPage() {
  try {
    await apiFetchServer("/auth/me");
    redirect("/dashboard");
  } catch (error) {
    if (error instanceof ApiAuthError) {
      redirect("/login");
    }
    throw error;
  }
}
