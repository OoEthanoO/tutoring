import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestAuthContext: mocks.auth, getAdminClient: mocks.db }));
import { GET, POST, DELETE } from "./route";

const classId = "11111111-1111-4111-8111-111111111111";
const trialId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const discord = "123456789012345678";
const actor = { id: actorId, email: "ceo@example.test", role: "CEO" };
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>, writes: Row[];
let failTable: string | null;
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ actor }); mocks.rpc.mockResolvedValue({ data: trialId, error: null });
  writes = []; failTable = null;
  tables = {
    course_classes: [{ id: classId, course_id: "course", starts_at: "2026-10-01T18:00:00Z", duration_hours: 1,
      course: { id: "course", title: "Python", created_by: "tutor", created_by_email: "tutor@example.test", deleted_at: null, is_completed: false } }],
    app_users: [{ id: "tutor", email: "tutor@example.test", role: "executive" },
      { id: "leader", email: "leader@example.test", role: "student", custom_roles: { role_level: "COO" } }],
    approved_discord_accounts: [], class_trials: [],
  };
  mocks.db.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const filters: ((r: Row) => boolean)[] = []; let bounds: number[] | null = null, patch: Row | null = null;
    const result = () => {
      if (failTable === table) return { data: null, error: { message: "unavailable" } };
      let data = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      if (bounds) data = data.slice(bounds[0], bounds[1] + 1);
      if (patch) { writes.push({ table, patch, ids: data.map(r => r.id) }); data.forEach(r => Object.assign(r, patch)); }
      return { data, error: null };
    };
    const q = {
      select: () => q, order: () => q, limit: () => q, is: () => q, gte: () => q,
      eq: (k: string, v: unknown) => { if (!k.includes(".")) filters.push(r => r[k] === v); return q; },
      range: (a: number, b: number) => { bounds = [a, b]; return q; },
      update: (data: Row) => { patch = data; return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (r: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }; return q;
  } });
});
const request = (body: unknown, method = "POST") => new NextRequest("https://example.test/api/admin/class-trials", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const body = { classId, discordUserId: discord, studentName: "Trial Student" };

describe("trial management authorization", () => {
  it.each([null, { ...actor, role: "student" }, { ...actor, role: "executive" }])("rejects a non-management actor on every method", async user => {
    mocks.auth.mockResolvedValue({ actor: user });
    expect((await GET(new NextRequest("https://example.test/api/admin/class-trials"))).status).toBe(403);
    expect((await POST(request(body))).status).toBe(403);
    expect((await DELETE(request({ id: trialId }, "DELETE"))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["CEO", "COO", "CEO Shadow", "COO Shadow"])("lets %s book a guest without creating a website account or enrollment", async role => {
    mocks.auth.mockResolvedValue({ actor: { ...actor, role } });
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("save_class_trial", { p_class_id: classId, p_discord_user_id: discord, p_student_name: "Trial Student", p_actor_id: actorId, p_replace_owner_id: null });
    expect(writes).toEqual([]);
  });
  it("requires explicit conversion of an existing approved extra account", async () => {
    tables.approved_discord_accounts = [{ discord_user_id: discord, owner_user_id: "tutor" }];
    expect((await POST(request(body))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await POST(request({ ...body, replaceApprovedAccount: true }))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_replace_owner_id).toBe("tutor");
  });
  it("prevents a Shadow converting a protected leader's extra account, including custom-role aliases", async () => {
    mocks.auth.mockResolvedValue({ actor: { ...actor, role: "CEO Shadow" } });
    tables.approved_discord_accounts = [{ discord_user_id: discord, owner_user_id: "leader" }];
    expect((await POST(request({ ...body, replaceApprovedAccount: true }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed identities and failed ownership queries without writing", async () => {
    expect((await POST(request({ ...body, discordUserId: "123" }))).status).toBe(400);
    expect((await POST(request({ ...body, studentName: "\n" }))).status).toBe(400);
    failTable = "approved_discord_accounts";
    expect((await POST(request(body))).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("revokes by retaining the row needed for Discord cleanup", async () => {
    tables.class_trials = [{ id: trialId, revoked_at: null }];
    expect((await DELETE(request({ id: trialId }, "DELETE"))).status).toBe(200);
    expect(tables.class_trials[0].revoked_at).toBeTruthy();
    expect(tables.class_trials).toHaveLength(1);
  });
});
