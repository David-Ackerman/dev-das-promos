import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../badge.js";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge status="approved">Approved</Badge>);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("maps a known status to its color classes", () => {
    render(<Badge status="rejected">Rejected</Badge>);
    expect(screen.getByText("Rejected")).toHaveClass("bg-red-500/15");
  });

  it("falls back to the neutral classes for an unknown status", () => {
    render(<Badge status="something-unknown">?</Badge>);
    expect(screen.getByText("?")).toHaveClass("bg-neutral-500/15");
  });

  it("falls back to the neutral classes when status is omitted", () => {
    render(<Badge>No status</Badge>);
    expect(screen.getByText("No status")).toHaveClass("bg-neutral-500/15");
  });
});
