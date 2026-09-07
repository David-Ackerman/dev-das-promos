import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { DealActions } from "../deal-actions.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("DealActions", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all four action buttons", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWithClient(<DealActions dealId="deal-1" status="pending" />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-evaluate" })).toBeInTheDocument();
  });

  it.each(["pending", "rejected"])("disables Publish when status is %s", (status) => {
    vi.stubGlobal("fetch", vi.fn());
    renderWithClient(<DealActions dealId="deal-1" status={status} />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it.each(["approved", "auto_approved", "published"])(
    "enables Publish when status is %s",
    (status) => {
      vi.stubGlobal("fetch", vi.fn());
      renderWithClient(<DealActions dealId="deal-1" status={status} />);
      expect(screen.getByRole("button", { name: "Publish" })).not.toBeDisabled();
    },
  );

  it("posts to /admin/deals/:id/approve, shows a pending label, then refreshes on success", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(<DealActions dealId="deal-42" status="pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approving..." })).toBeInTheDocument(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/admin/deals/deal-42/approve",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );

    resolveFetch({ ok: true, status: 204 });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows the mutation error message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );

    renderWithClient(<DealActions dealId="deal-7" status="pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(
        screen.getByText("Request to /admin/deals/deal-7/reject failed with 500: boom"),
      ).toBeInTheDocument(),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
