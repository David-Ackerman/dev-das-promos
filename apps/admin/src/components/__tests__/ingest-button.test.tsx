import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { IngestButtons } from "../ingest-button.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("IngestButtons", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders a button for each marketplace", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWithClient(<IngestButtons />);

    expect(screen.getByRole("button", { name: "Amazon BR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shopee BR" })).toBeInTheDocument();
  });

  it("posts to /admin/ingestion/run with the chosen marketplace, disables both buttons while pending, then shows success and refreshes", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(<IngestButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Amazon BR" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Amazon BR" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Shopee BR" })).toBeDisabled();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/admin/ingestion/run",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ marketplace: "amazon_br" }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );

    resolveFetch({ ok: true, status: 200, json: async () => ({}) });

    await waitFor(() =>
      expect(screen.getByText("Queued -- refreshing shortly...")).toBeInTheDocument(),
    );

    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
