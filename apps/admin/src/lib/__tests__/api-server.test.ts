import { ADMIN_SESSION_COOKIE_NAME } from "@dev-das-promos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cookies } = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies }));

import { ApiAuthError, apiFetchServer } from "../api-server.js";

describe("apiFetchServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cookies.mockReset();
  });

  it("forwards only the admin session cookie and disables caching", async () => {
    cookies.mockResolvedValue({
      get: () => ({ name: ADMIN_SESSION_COOKIE_NAME, value: "abc123" }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetchServer("/auth/me");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/auth/me",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=abc123`,
          "content-type": "application/json",
        }),
      }),
    );
    expect(result).toEqual({ id: "1" });
  });

  it("merges caller-provided init headers with the cookie header", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetchServer("/admin/deals", { headers: { "x-custom": "1" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/admin/deals",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-custom": "1", cookie: "" }),
      }),
    );
  });

  it("throws ApiAuthError on a 401 response instead of a generic Error", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(apiFetchServer("/auth/me")).rejects.toBeInstanceOf(ApiAuthError);
    await expect(apiFetchServer("/auth/me")).rejects.toThrow("Not authenticated");
  });

  it("throws a descriptive Error for other non-ok statuses", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "server exploded" }),
    );

    await expect(apiFetchServer("/admin/deals")).rejects.toThrow(
      "API request to /admin/deals failed with 500: server exploded",
    );
  });
});
