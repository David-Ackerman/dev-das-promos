"use client";

import { Button } from "@/components/ui/button";
import { apiFetchClient } from "@/lib/api-client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export function IngestButtons() {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: (marketplace: "amazon_br" | "shopee_br" | "mercado_livre") =>
      apiFetchClient("/admin/ingestion/run", {
        method: "POST",
        body: JSON.stringify({ marketplace }),
      }),
    onSuccess: () => {
      // Ingestion + evaluation run asynchronously via BullMQ; give workers a moment then refresh.
      setTimeout(() => router.refresh(), 1500);
    },
  });

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-neutral-400">Ingest mock offers:</span>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("amazon_br")}
      >
        Amazon BR
      </Button>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("shopee_br")}
      >
        Shopee BR
      </Button>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("mercado_livre")}
      >
        Mercado Livre
      </Button>
      {mutation.isSuccess && (
        <span className="text-xs text-emerald-400">Queued -- refreshing shortly...</span>
      )}
    </div>
  );
}
