import { clsx } from "clsx";
import type { ReactNode } from "react";

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  auto_approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  published: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  expired: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  queued: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  publishing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        status
          ? (STATUS_CLASSES[status] ?? "bg-neutral-500/15 text-neutral-300 border-neutral-500/30")
          : "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
      )}
    >
      {children}
    </span>
  );
}
