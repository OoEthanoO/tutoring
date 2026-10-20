import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

// PostgREST rows by table, as the gateway would answer them.
let rows: Record<string, unknown[]> = {};
const answerFromRows = async (input: RequestInfo | URL) => {
  const table = new URL(String(input)).pathname.split("/").pop() ?? "";
  return new Response(JSON.stringify(rows[table] ?? []), { headers: { "content-type": "application/json" } });
};
const fetchMock = vi.fn(answerFromRows);

beforeEach(() => {
  rows = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(answerFromRows);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SUPABASE_URL", "http://database.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const visitOnboarding = (session?: string) =>
  middleware(new NextRequest("https://learn.ethanyanxu.com/onboarding?next=%2Fcourses", {
    headers: session ? { cookie: `session=${session}` } : {},
  }));

const redirectPath = (response: Response) => {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
};

describe("onboarding guard", () => {
  it("sends visitors without a session to the login page", async () => {
    expect(redirectPath(await visitOnboarding())).toBe("/login");
  });

  it("sends an unknown or expired session to the login page", async () => {
    expect(redirectPath(await visitOnboarding("stale-token"))).toBe("/login");
  });

  it("lets a signed-in account without a name fill it in", async () => {
    rows = { app_sessions: [{ user_id: "user-1" }], app_users: [{ full_name: "  " }] };
    const response = await visitOnboarding("live-token");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(redirectPath(response)).toBeNull();
  });

  it("sends an account that already has a name home", async () => {
    rows = { app_sessions: [{ user_id: "user-1" }], app_users: [{ full_name: "Alex Johnson" }] };
    expect(redirectPath(await visitOnboarding("live-token"))).toBe("/");
  });

  it("looks the session up the way the API routes do", async () => {
    await visitOnboarding("live-token");
    const lookup = fetchMock.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname.endsWith("/app_sessions"));
    const hash = createHash("sha256").update("live-token").digest("hex");
    expect(lookup?.searchParams.get("token_hash")).toBe(`eq.${hash}`);
    expect(lookup?.searchParams.get("expires_at")).toMatch(/^gt\./);
  });

  it("treats an unreachable database as signed out", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    expect(redirectPath(await visitOnboarding("live-token"))).toBe("/login");
  });
});
