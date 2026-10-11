"use client";

import { apiFetchClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PublicationRetryButton({
  id,
  requiresConfirmation,
}: {
  id: string;
  requiresConfirmation: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (
      requiresConfirmation &&
      !window.confirm(
        "The previous attempt may have been accepted before an error or timeout. Check the external channel first to avoid a duplicate. Retry anyway?",
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await apiFetchClient(`/admin/publications/${id}/retry`, { method: "POST" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retry failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Queuing…" : "Retry"}
      </button>
      {error && <p className="mt-1 max-w-48 text-xs text-red-300">{error}</p>}
    </div>
  );
}
