import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Nav } from "../nav.js";

describe("Nav", () => {
  it("renders the brand name", () => {
    render(<Nav />);
    expect(screen.getByText("das-promos admin")).toBeInTheDocument();
  });

  it("renders a link for every nav item with the correct href", () => {
    render(<Nav />);

    const expected: Array<[string, string]> = [
      ["Dashboard", "/dashboard"],
      ["Deals", "/deals"],
      ["Products", "/products"],
      ["Analytics", "/analytics"],
      ["Publications", "/publications"],
    ];

    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });
});
