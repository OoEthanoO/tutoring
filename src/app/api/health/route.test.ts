import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("deployment health", () => {
  it("does not declare an unconfigured server ready", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await GET()).status).toBe(503);
  });

  it("identifies the running release without exposing credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-service-key");
    vi.stubEnv("YANLEARN_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("YANLEARN_HOST", "finprint-host");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({status: "ok", commit: "a".repeat(40), hosting: "finprint-host"});
  });
});
