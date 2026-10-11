"use client";

import { apiFetchClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState(false);

  async function handleLogout() {
    setError(false);
    try {
      await apiFetchClient("/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      {error && <span className="text-xs text-red-400">Could not sign out. Try again.</span>}
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
      >
        Sign out
      </button>
    </div>
  );
}
