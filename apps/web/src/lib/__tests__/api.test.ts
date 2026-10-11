import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_API_URL = process.env.API_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_API_URL === undefined) {
    Reflect.deleteProperty(process.env, "API_URL");
  } else {
    process.env.API_URL = ORIGINAL_API_URL;
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("apiGet", () => {
  it("builds the URL from the default API_URL when the env var is unset", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    const result = await apiGet("/deals/123");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/deals/123", {
      next: { revalidate: 60 },
    });
    expect(result).toEqual({ hello: "world" });
  });

  it("builds the URL from a custom API_URL env var", async () => {
    process.env.API_URL = "https://api.example.com";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    await apiGet("/foo");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/foo", {
      next: { revalidate: 60 },
    });
  });

  it("passes through a custom revalidate option", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    await apiGet("/x", 120);

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/x", {
      next: { revalidate: 120 },
    });
  });

  it("returns null on a 404 response", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("should not be called");
      },
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    const result = await apiGet("/missing");

    expect(result).toBeNull();
  });

  it("throws on a non-ok, non-404 response", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    await expect(apiGet("/broken")).rejects.toThrow("Request to /broken failed with 500");
  });

  it("propagates a network failure instead of swallowing it", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { apiGet } = await import("../api.js");
    await expect(apiGet("/offline")).rejects.toThrow("network down");
  });
});

describe("apiGoUrl", () => {
  it("builds a go redirect URL using the default API_URL", async () => {
    Reflect.deleteProperty(process.env, "API_URL");
    const { apiGoUrl } = await import("../api.js");
    expect(apiGoUrl("abc123")).toBe("http://localhost:4000/go/abc123");
  });

  it("builds a go redirect URL using a custom API_URL", async () => {
    process.env.API_URL = "https://api.example.com";
    const { apiGoUrl } = await import("../api.js");
    expect(apiGoUrl("abc123")).toBe("https://api.example.com/go/abc123");
  });
});
