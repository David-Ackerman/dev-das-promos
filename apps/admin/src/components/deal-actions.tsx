"use client";

import { Button } from "@/components/ui/button";
import { apiFetchClient } from "@/lib/api-client";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DealActions({
  dealId,
  status,
  publicationNeedsReview = false,
}: {
  dealId: string;
  status: string;
  publicationNeedsReview?: boolean;
}) {
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
  const canApprove = status === "pending" || status === "auto_approved" || status === "rejected";
  const canReject = status !== "rejected" && status !== "expired";

  return (
    <div className="flex flex-wrap gap-2">
      {canApprove && (
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("approve")}
        >
          {pendingAction === "approve" ? "Approving..." : "Approve"}
        </Button>
      )}
      {canReject && (
        <Button
          variant="destructive"
          disabled={mutation.isPending}
          onClick={() => {
            if (
              status === "published" &&
              !window.confirm(
                "This removes the offer from the public catalog, but existing Telegram/X posts will remain. Continue?",
              )
            ) {
              return;
            }
            mutation.mutate("reject");
          }}
        >
          {pendingAction === "reject" ? "Rejecting..." : "Reject"}
        </Button>
      )}
      {publicationNeedsReview ? (
        <Link
          href="/publications"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          Check Publications
        </Link>
      ) : (
        <Button
          disabled={mutation.isPending || !canPublish}
          onClick={() => mutation.mutate("publish")}
        >
          {pendingAction === "publish" ? "Queuing..." : "Publish"}
        </Button>
      )}
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
