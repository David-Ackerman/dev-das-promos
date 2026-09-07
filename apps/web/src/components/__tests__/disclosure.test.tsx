import { DISCLOSURE_TEXT } from "@dev-das-promos/config";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "../disclosure.js";

afterEach(cleanup);

describe("Disclosure", () => {
  it("renders the web affiliate disclosure text", () => {
    render(<Disclosure />);
    expect(screen.getByText(DISCLOSURE_TEXT.web)).toBeInTheDocument();
  });
});
