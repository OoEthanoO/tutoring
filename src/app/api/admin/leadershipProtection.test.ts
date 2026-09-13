import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/authServer", () => ({
  getRequestUser: mocks.user, getRequestActor: mocks.user, getAdminClient: mocks.admin,
  getRequestAuthContext: async () => ({ actor: await mocks.user(), user: await mocks.user() }),
  IMPERSONATE_COOKIE: "impersonate_user_id",
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.admin }));
vi.mock("@/lib/notificationsServer", () => ({ sendDiscordMessageByChannelName: mocks.notify }));
vi.mock("@/lib/discordSync", () => ({ fetchDiscordGuildMemberIds: async () => new Set() }));

let users: typeof import("./users/route");
let roles: typeof import("./roles/route");
let bans: typeof import("./banned-emails/route");
let approved: typeof import("./approved-discord-accounts/route");
let impersonation: typeof import("../auth/impersonation/route");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  [users, roles, bans, approved, impersonation] = await Promise.all([
    import("./users/route"), import("./roles/route"), import("./banned-emails/route"),
    import("./approved-discord-accounts/route"), import("../auth/impersonation/route"),
  ]);
});
afterEach(() => { vi.clearAllMocks(); });

const shadow = { id: "shadow", email: "shadow@example.test", role: "CEO Shadow" };
const leader = { id: "leader", email: "leader@example.test", role: "tutor", custom_role: "Operations", custom_roles: { role_level: "COO" } };
const regular = { id: "regular", email: "regular@example.test", role: "tutor" };
const writes = vi.fn();
function setup(actor = shadow, failLookup = false) {
  mocks.user.mockResolvedValue(actor);
  mocks.admin.mockReturnValue({ from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let writing = false;
    const rows = () => {
      if (writing) return [{ ...regular, role: "tutor" }];
      if (table === "app_users") return [shadow, leader, regular].filter((r) => Object.entries(filters).every(([k, v]) => r[k as keyof typeof r] === v));
      if (table === "custom_roles") return [{ name: "Operations", role_level: "COO" }, { name: "CEO Shadow", role_level: "CEO Shadow" }]
        .filter((r) => !filters.name || r.name === filters.name);
      if (table === "approved_discord_accounts") return [{ owner_user_id: "leader" }];
      return [];
    };
    const result = () => failLookup && table === "app_users" && !writing
      ? { data: null, error: { message: "Database unavailable" } }
      : { data: rows(), error: null };
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      ilike: (key: string, value: unknown) => { filters[key] = value; return query; },
      update: (payload: unknown) => { writes(table, "update", payload); writing = true; return query; },
      insert: (payload: unknown) => { writes(table, "insert", payload); writing = true; return query; },
      delete: () => { writes(table, "delete"); writing = true; return query; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } });
}
const request = (body: unknown, method = "POST") => new NextRequest("https://example.test/api/admin/users", {
  method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

describe("Shadow management API boundaries", () => {
  it.each(["CEO Shadow", "COO Shadow"])("allows %s to load the role manager", async (role) => {
    setup({ ...shadow, role });
    const response = await roles.GET(new NextRequest("https://example.test/api/admin/roles"));
    expect(response.status).toBe(200);
    expect((await response.json()).allowedRoleLevels).toEqual(["CEO Shadow", "COO Shadow", "Chief Executive", "Executive", "Student"]);
  });
  it.each([
    { role: "student" }, { customRole: null }, { customRole: "CEO Shadow" },
    { strikeCount: 2 }, { pendingRoleExempt: false }, { isJunior: true },
    { transferDiscordFromEmail: regular.email },
  ])("blocks leadership access changes before side effects: %j", async (change) => {
    setup();
    expect((await users.PATCH(request({ userId: "leader", ...change }, "PATCH"))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("blocks transferring a leader's linked Discord account to a shadow", async () => {
    setup();
    expect((await users.PATCH(request({ userId: "shadow", transferDiscordFromEmail: leader.email }, "PATCH"))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([{ role: "CEO" }, { customRole: "Operations" }])("blocks direct and custom-role self escalation: %j", async (change) => {
    setup();
    expect((await users.PATCH(request({ userId: "shadow", ...change }, "PATCH"))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it("blocks deletion, email bans, and impersonation of top leadership", async () => {
    setup();
    expect((await users.DELETE(request({ userId: "leader" }, "DELETE"))).status).toBe(403);
    expect((await bans.POST(request({ email: leader.email }))).status).toBe(403);
    expect((await impersonation.POST(request({ userId: "leader" }))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it("protects a founder email even if the account is not present", async () => {
    setup();
    expect((await bans.POST(request({ email: "ethanxucoder@gmail.com" }))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it("blocks creating or revoking extra Discord accounts for a leader", async () => {
    setup();
    expect((await approved.POST(request({ discordUserId: "123456789012345678", ownerUserId: "leader" }))).status).toBe(403);
    expect((await approved.DELETE(request({ discordUserId: "123456789012345678" }, "DELETE"))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([{ name: "New title", role_level: "CEO" }, { name: "Founder", role_level: "Executive" }])("blocks top-tier custom-role creation: %j", async (definition) => {
    setup();
    expect((await roles.POST(request(definition))).status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });
  it("fails closed when the protected account lookup fails", async () => {
    setup(shadow, true);
    expect((await users.DELETE(request({ userId: "leader" }, "DELETE"))).status).toBe(503);
    expect(writes).not.toHaveBeenCalled();
  });
  it("still allows shadows to manage regular accounts", async () => {
    setup();
    expect((await users.DELETE(request({ userId: "regular" }, "DELETE"))).status).toBe(200);
    expect(writes).toHaveBeenCalledWith("app_users", "delete");
  });
  it("allows ordinary profile edits on a leadership account", async () => {
    setup();
    expect((await users.PATCH(request({ userId: "leader", school: "Example school" }, "PATCH"))).status).toBe(200);
    expect(writes).toHaveBeenCalledWith("app_users", "update", expect.objectContaining({ school: "Example school" }));
  });
  it("clears the custom role when a CEO demotes a shadow to student", async () => {
    setup({ ...shadow, role: "CEO" });
    expect((await users.PATCH(request({ userId: "shadow", role: "student" }, "PATCH"))).status).toBe(200);
    expect(writes).toHaveBeenCalledWith("app_users", "update", expect.objectContaining({ role: "student", custom_role: null }));
  });
  it("retains CEO authority to assign top leadership roles", async () => {
    setup({ ...shadow, role: "CEO" });
    expect((await roles.POST(request({ name: "New title", role_level: "COO" }))).status).toBe(200);
    expect(writes).toHaveBeenCalledWith("custom_roles", "insert", { name: "New title", role_level: "COO" });
  });
});
