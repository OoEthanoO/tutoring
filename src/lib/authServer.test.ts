import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
let auth: typeof import("./authServer");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  auth = await import("./authServer");
});
afterEach(() => { vi.clearAllMocks(); });
const actor = { id: "shadow", email: "shadow@example.test", role: "tutor", custom_role: "CEO Shadow", custom_roles: { role_level: "CEO Shadow" } };
function setup(targetLevel: string, actorLevel = "CEO Shadow") {
  mocks.createClient.mockReturnValue({ from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, gt: () => query,
      maybeSingle: async () => ({ data: table === "app_sessions"
        ? { user: { ...actor, custom_role: actorLevel, custom_roles: { role_level: actorLevel } } }
        : { id: "target", email: "target@example.test", role: "tutor", custom_role: "Custom title", custom_roles: { role_level: targetLevel } }, error: null }),
    };
    return query;
  } });
}
const request = { cookies: { get: (name: string) => ({ value: name === "session" ? "token" : "target" }) } };
describe("effective session privileges", () => {
  it("resolves custom shadow privileges at the session boundary for every API and client", async () => {
    setup("Executive");
    expect((await auth.getSessionUser("token"))?.role).toBe("CEO Shadow");
  });
  it.each(["CEO", "COO"])("ignores a forged or stale impersonation cookie targeting %s", async (level) => {
    setup(level);
    expect((await auth.getRequestUser(request))?.id).toBe("shadow");
    const context = await auth.getRequestAuthContext(request);
    expect(context.user?.id).toBe("shadow");
    expect(context.isImpersonating).toBe(false);
  });
  it("allows normal impersonation of regular accounts", async () => {
    setup("Executive");
    expect((await auth.getRequestUser(request))?.id).toBe("target");
    expect((await auth.getRequestAuthContext(request)).isImpersonating).toBe(true);
  });
  it("revokes impersonation when the actor loses their shadow role", async () => {
    setup("CEO", "Executive");
    expect((await auth.getRequestUser(request))?.id).toBe("shadow");
  });
});
