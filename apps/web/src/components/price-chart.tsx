import { formatCentsBRL } from "@dev-das-promos/shared";

export interface PricePoint {
  capturedAt: string;
  effectivePriceCents: number;
}

const WIDTH = 600;
const HEIGHT = 160;
const PADDING = 24;

/**
 * Minimal dependency-free SVG line chart. Deliberately not pulling in a
 * charting library for a single sparkline -- see docs/architecture.md
 * "Price charts" for the tradeoff.
 */
export function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-neutral-500">
        Ainda não há histórico de preços suficiente para exibir o gráfico.
      </p>
    );
  }

  const prices = points.map((p) => p.effectivePriceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = PADDING + (i / (points.length - 1)) * (WIDTH - PADDING * 2);
    const y = HEIGHT - PADDING - ((p.effectivePriceCents - min) / range) * (HEIGHT - PADDING * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Gráfico do histórico de preços"
      >
        <polyline points={coords.join(" ")} fill="none" stroke="#2563eb" strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-neutral-500">
        <span>Menor preço: {formatCentsBRL(min)}</span>
        <span>Maior preço: {formatCentsBRL(max)}</span>
      </div>
    </div>
  );
}
