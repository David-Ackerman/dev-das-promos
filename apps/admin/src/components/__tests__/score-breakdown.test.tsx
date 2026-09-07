import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBreakdown } from "../score-breakdown.js";

describe("ScoreBreakdown", () => {
  it("renders a row for every known label, defaulting missing components to 0", () => {
    render(<ScoreBreakdown components={{}} />);

    expect(screen.getByText("Historical discount")).toBeInTheDocument();
    expect(screen.getByText("Discount")).toBeInTheDocument();
    expect(screen.getByText("Commission")).toBeInTheDocument();
    expect(screen.getByText("Seller")).toBeInTheDocument();
    expect(screen.getByText("Popularity")).toBeInTheDocument();
    expect(screen.getByText("Conversion")).toBeInTheDocument();
    expect(screen.getByText("Freshness")).toBeInTheDocument();

    // 7 labels, each defaulting to a formatted "0" value.
    expect(screen.getAllByText("0")).toHaveLength(7);
  });

  it("renders the provided value for a known component, formatted with no decimals", () => {
    render(<ScoreBreakdown components={{ discount: 42.6 }} />);
    expect(screen.getByText("43")).toBeInTheDocument();
  });

  it("clamps the bar width to a maximum of 100%", () => {
    render(<ScoreBreakdown components={{ discount: 150 }} />);
    const row = screen.getByText("Discount").closest("div");
    const bar = row?.querySelector(".bg-blue-500") as HTMLElement;
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(bar).toHaveStyle({ width: "100%" });
  });

  it("clamps the bar width to a minimum of 0%", () => {
    render(<ScoreBreakdown components={{ discount: -30 }} />);
    const row = screen.getByText("Discount").closest("div");
    const bar = row?.querySelector(".bg-blue-500") as HTMLElement;
    expect(screen.getByText("-30")).toBeInTheDocument();
    expect(bar).toHaveStyle({ width: "0%" });
  });

  it("ignores components not present in the known label set", () => {
    render(<ScoreBreakdown components={{ unknownKey: 99 }} />);
    expect(screen.queryByText("unknownKey")).not.toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
  });
});
