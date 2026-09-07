import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardTitle, CardValue } from "../card.js";

describe("Card", () => {
  it("renders children and the base card classes", () => {
    render(<Card data-testid="card">Content</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveTextContent("Content");
    expect(card).toHaveClass("card", "p-5");
  });

  it("merges an additional className with the base classes", () => {
    render(
      <Card data-testid="card" className="extra-class">
        Content
      </Card>,
    );
    expect(screen.getByTestId("card")).toHaveClass("card", "p-5", "extra-class");
  });

  it("forwards arbitrary props to the underlying div", () => {
    render(<Card data-testid="card" aria-label="stats" />);
    expect(screen.getByTestId("card")).toHaveAttribute("aria-label", "stats");
  });
});

describe("CardTitle", () => {
  it("renders children with the title classes", () => {
    render(<CardTitle>Total deals</CardTitle>);
    const title = screen.getByText("Total deals");
    expect(title.tagName).toBe("H3");
    expect(title).toHaveClass("text-sm", "font-medium", "text-neutral-400");
  });
});

describe("CardValue", () => {
  it("renders children with the value classes", () => {
    render(<CardValue>42</CardValue>);
    const value = screen.getByText("42");
    expect(value).toHaveClass("mt-1", "text-2xl", "font-semibold");
  });
});
