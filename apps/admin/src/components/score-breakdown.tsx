const LABELS: Record<string, string> = {
  historicalDiscount: "Historical discount",
  discount: "Discount",
  commission: "Commission",
  seller: "Seller",
  popularity: "Popularity",
  conversion: "Conversion",
  freshness: "Freshness",
};

export function ScoreBreakdown({ components }: { components: Record<string, number> }) {
  return (
    <div className="space-y-2">
      {Object.entries(LABELS).map(([key, label]) => {
        const value = components[key] ?? 0;
        return (
          <div key={key} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-sm text-neutral-400">{label}</span>
            <div className="h-2 flex-1 rounded-full bg-neutral-800">
              <div
                className="h-2 rounded-full bg-blue-500"
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-medium">{value.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}
