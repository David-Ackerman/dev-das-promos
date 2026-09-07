import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBadge } from "../score-badge.js";

describe("ScoreBadge", () => {
  it("renders the rounded score and label", () => {
    render(<ScoreBadge score={87.6} label="Great deal" />);
    expect(screen.getByText("88 · Great deal")).toBeInTheDocument();
  });

  it("uses the top tier color for scores >= 90", () => {
    render(<ScoreBadge score={95} label="Top" />);
    expect(screen.getByText("95 · Top")).toHaveClass("bg-emerald-100");
  });

  it("uses the lowest tier color for scores below 50", () => {
    render(<ScoreBadge score={20} label="Low" />);
    expect(screen.getByText("20 · Low")).toHaveClass("bg-neutral-200");
  });
});
