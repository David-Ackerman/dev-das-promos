import { formatCentsBRL } from "@dev-das-promos/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DealCard, type DealCardData } from "../deal-card.js";

afterEach(cleanup);

/** testing-library's default text normalizer maps NBSP to a regular space. */
const normalizeSpace = (value: string) => value.replace(/ /g, " ");

const baseDeal: DealCardData = {
  slug: "some-great-product",
  productName: "Some Great Product",
  imageUrl: "https://example.com/image.jpg",
  marketplace: "amazon_br",
  effectivePriceCents: 129990,
  realDiscountPercentage: 25,
  dealScore: 87.6,
  scoreLabel: "Great deal",
};

describe("DealCard", () => {
  it("links to the deal page by slug", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/deal/some-great-product");
  });

  it("renders the formatted price", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText(normalizeSpace(formatCentsBRL(129990)))).toBeInTheDocument();
  });

  it("renders the discount badge when there is a real discount", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("-25%")).toBeInTheDocument();
  });

  it("omits the discount badge when there is no discount", () => {
    render(<DealCard deal={{ ...baseDeal, realDiscountPercentage: 0 }} />);
    expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
  });

  it("renders the product name and mapped marketplace label", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("Some Great Product")).toBeInTheDocument();
    expect(screen.getByText("Amazon BR")).toBeInTheDocument();
  });

  it("falls back to the raw marketplace string when unmapped", () => {
    render(<DealCard deal={{ ...baseDeal, marketplace: "some_future_marketplace" }} />);
    expect(screen.getByText("some_future_marketplace")).toBeInTheDocument();
  });

  it("renders the score badge with the rounded score and label", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByText("88 · Great deal")).toBeInTheDocument();
  });

  it("renders an image when imageUrl is present", () => {
    render(<DealCard deal={baseDeal} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Some Great Product");
  });

  it("renders no image when imageUrl is null", () => {
    render(<DealCard deal={{ ...baseDeal, imageUrl: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
