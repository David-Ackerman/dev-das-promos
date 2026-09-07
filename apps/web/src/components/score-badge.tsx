import { clsx } from "clsx";

const SCORE_CLASSES = (score: number) => {
  if (score >= 90) return "bg-emerald-100 text-emerald-800";
  if (score >= 80) return "bg-lime-100 text-lime-800";
  if (score >= 70) return "bg-amber-100 text-amber-800";
  if (score >= 50) return "bg-orange-100 text-orange-800";
  return "bg-neutral-200 text-neutral-700";
};

export function ScoreBadge({ score, label }: { score: number; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        SCORE_CLASSES(score),
      )}
    >
      {score.toFixed(0)} · {label}
    </span>
  );
}
