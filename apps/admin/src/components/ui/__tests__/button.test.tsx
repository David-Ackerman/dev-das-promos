import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../button.js";

describe("Button", () => {
  it("renders children and defaults to the default variant classes", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("bg-blue-600", "text-white");
  });

  it.each([
    ["outline", "border-neutral-700"],
    ["destructive", "bg-red-600"],
    ["ghost", "text-neutral-300"],
  ] as const)("applies the %s variant classes", (variant, expectedClass) => {
    render(<Button variant={variant}>Action</Button>);
    expect(screen.getByRole("button", { name: "Action" })).toHaveClass(expectedClass);
  });

  it("merges a custom className with the variant classes", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button", { name: "Wide" })).toHaveClass("w-full", "bg-blue-600");
  });

  it("is disabled when the disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Click me
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
