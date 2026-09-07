import { formatCentsBRL } from "@dev-das-promos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PriceChart, type PricePoint } from "../price-chart.js";

afterEach(cleanup);

/** testing-library's default text normalizer maps NBSP to a regular space. */
const normalizeSpace = (value: string) => value.replace(/ /g, " ");

describe("PriceChart", () => {
  it("shows a fallback message with zero points", () => {
    render(<PriceChart points={[]} />);
    expect(screen.getByText("Not enough price history yet to plot a chart.")).toBeInTheDocument();
  });

  it("shows a fallback message with a single point", () => {
    render(<PriceChart points={[{ capturedAt: "2026-01-01", effectivePriceCents: 1000 }]} />);
    expect(screen.getByText("Not enough price history yet to plot a chart.")).toBeInTheDocument();
  });

  it("renders an svg chart with min/max labels for two or more points", () => {
    const points: PricePoint[] = [
      { capturedAt: "2026-01-01", effectivePriceCents: 1000 },
      { capturedAt: "2026-01-02", effectivePriceCents: 500 },
      { capturedAt: "2026-01-03", effectivePriceCents: 1500 },
    ];
    render(<PriceChart points={points} />);
    expect(screen.getByRole("img", { name: "Price history chart" })).toBeInTheDocument();
    expect(screen.getByText(normalizeSpace(`Lowest: ${formatCentsBRL(500)}`))).toBeInTheDocument();
    expect(
      screen.getByText(normalizeSpace(`Highest: ${formatCentsBRL(1500)}`)),
    ).toBeInTheDocument();
  });

  it("plots one coordinate per point on the polyline", () => {
    const points: PricePoint[] = [
      { capturedAt: "2026-01-01", effectivePriceCents: 1000 },
      { capturedAt: "2026-01-02", effectivePriceCents: 2000 },
      { capturedAt: "2026-01-03", effectivePriceCents: 1200 },
    ];
    const { container } = render(<PriceChart points={points} />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("points")?.trim().split(" ")).toHaveLength(3);
  });
});
