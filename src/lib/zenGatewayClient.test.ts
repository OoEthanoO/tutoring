import { afterEach, describe, expect, it, vi } from "vitest";
import { getZenVoiceMembers, isZenWorkerAuthorized, zenGatewayUrl } from "./zenGatewayClient";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("private Zen worker connection", () => {
  it("requires the exact server secret and fails closed if it is missing", () => {
    vi.stubEnv("CRON_SECRET", "test-only-secret");
    expect(isZenWorkerAuthorized("Bearer test-only-secret")).toBe(true);
    for (const value of [null, "", "Bearer wrong", "Bearer test-only-secrex"]) expect(isZenWorkerAuthorized(value)).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    expect(isZenWorkerAuthorized("Bearer ")).toBe(false);
  });
  it("only permits a loopback port, never an external URL", () => {
    vi.stubEnv("YANLEARN_ZEN_GATEWAY_PORT", "3102");
    expect(zenGatewayUrl()).toBe("http://127.0.0.1:3102");
    for (const value of ["", "https://example.com", "0", "65536", "3102/path"]) {
      vi.stubEnv("YANLEARN_ZEN_GATEWAY_PORT", value);
      expect(zenGatewayUrl()).toBeNull();
    }
  });
  it("distinguishes nobody in voice from an unavailable or disconnected worker", async () => {
    vi.stubEnv("YANLEARN_ZEN_GATEWAY_PORT", "3102");
    vi.stubEnv("CRON_SECRET", "test-only-secret");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(Response.json({ ready: true, memberIds: [] }));
    expect(await getZenVoiceMembers()).toEqual([]);
    fetcher.mockResolvedValueOnce(Response.json({ ready: false, memberIds: [] }));
    expect(await getZenVoiceMembers()).toBeNull();
    fetcher.mockResolvedValueOnce(Response.json({ ready: true, memberIds: ["invalid"] }));
    expect(await getZenVoiceMembers()).toBeNull();
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await getZenVoiceMembers()).toBeNull();
  });
});
