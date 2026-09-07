import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetchClient } from "../api-client.js";

describe("apiFetchClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the request URL from the default API_URL and includes credentials + content-type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetchClient("/admin/deals");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/admin/deals",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("merges caller-provided init options and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetchClient("/admin/deals/1/approve", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "x-custom": "1" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/admin/deals/1/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json", "x-custom": "1" }),
      }),
    );
  });

  it("returns undefined for a 204 No Content response without parsing a body", async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetchClient("/admin/deals/1/publish", { method: "POST" });

    expect(result).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("throws an Error including the path, status, and response body when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetchClient("/admin/deals/missing")).rejects.toThrow(
      "Request to /admin/deals/missing failed with 404: not found",
    );
  });

  it("falls back to an empty body when reading the error body itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetchClient("/admin/deals/1")).rejects.toThrow(
      "Request to /admin/deals/1 failed with 500: ",
    );
  });
});
