import { describe, expect, it, vi } from "vitest";

import { fetchOwContext, OwContextError } from "./ow-context";

describe("fetchOwContext", () => {
  it("returns parsed snapshot JSON on 200", async () => {
    const snapshot = { schemaVersion: 1, project: { name: "demo" } };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => snapshot });
    const result = await fetchOwContext({ token: "abc", fetchImpl });
    expect(result).toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/ow/context/current",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer abc" } }),
    );
  });

  it("throws unauthorized on 401/403", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchOwContext({ token: "x", fetchImpl })).rejects.toBeInstanceOf(OwContextError);
    await expect(fetchOwContext({ token: "x", fetchImpl })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("throws not-synced on 503", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchOwContext({ token: "x", fetchImpl })).rejects.toMatchObject({ code: "not-synced" });
  });

  it("throws http on other non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchOwContext({ token: "x", fetchImpl })).rejects.toMatchObject({ code: "http" });
  });

  it("throws network when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("conn"));
    await expect(fetchOwContext({ token: "x", fetchImpl })).rejects.toMatchObject({ code: "network" });
  });

  it("omits Authorization header when no token (node env → readBridgeToken returns empty)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await fetchOwContext({ fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({});
  });
});
