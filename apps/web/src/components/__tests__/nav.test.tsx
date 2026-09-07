import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Nav } from "../nav.js";

afterEach(cleanup);

describe("Nav", () => {
  it("renders the brand link pointing home", () => {
    render(<Nav />);
    const brand = screen.getByRole("link", { name: "das promos" });
    expect(brand).toHaveAttribute("href", "/");
  });

  it("renders the all deals nav link", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "All deals" });
    expect(link).toHaveAttribute("href", "/deals");
  });
});
