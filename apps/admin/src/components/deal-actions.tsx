"use client";

import { Button } from "@/components/ui/button";
import { apiFetchClient } from "@/lib/api-client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DealActions({ dealId, status }: { dealId: string; status: string }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (action: "approve" | "reject" | "publish" | "re-evaluate") => {
      setPendingAction(action);
      return apiFetchClient(`/admin/deals/${dealId}/${action}`, { method: "POST" });
    },
    onSuccess: () => {
      router.refresh();
    },
    onSettled: () => setPendingAction(null),
  });

  const canPublish = status === "approved" || status === "auto_approved" || status === "published";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("approve")}
      >
        {pendingAction === "approve" ? "Approving..." : "Approve"}
      </Button>
      <Button
        variant="destructive"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("reject")}
      >
        {pendingAction === "reject" ? "Rejecting..." : "Reject"}
      </Button>
      <Button
        disabled={mutation.isPending || !canPublish}
        onClick={() => mutation.mutate("publish")}
      >
        {pendingAction === "publish" ? "Queuing..." : "Publish"}
      </Button>
      <Button
        variant="ghost"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("re-evaluate")}
      >
        {pendingAction === "re-evaluate" ? "Re-evaluating..." : "Re-evaluate"}
      </Button>
      {mutation.isError && (
        <p className="w-full text-sm text-red-400">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}
