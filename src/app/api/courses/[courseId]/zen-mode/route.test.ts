import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestUser: mocks.user, getAdminClient: mocks.db }));
vi.mock("@/lib/zenModeServer", () => ({ syncZenMode: mocks.sync, ZenBusyError: class extends Error {} }));
import { GET, POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ courseId: id }) };
let course: Record<string, unknown>;
const request = (enabled: unknown = true, origin = "https://example.test") => new NextRequest(`https://example.test/api/courses/${id}/zen-mode`, {
  method: "POST", body: JSON.stringify({ enabled }), headers: { origin, "Content-Type": "application/json" },
});
beforeEach(() => {
  vi.clearAllMocks();
  course = { id, created_by: "tutor", co_tutor_id: "co", zen_mode_enabled: false, deleted_at: null };
  mocks.user.mockResolvedValue({ id: "tutor", email: "tutor@example.test", role: "executive" });
  mocks.sync.mockResolvedValue({ problems: [] });
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: course, error: null }) };
  mocks.db.mockReturnValue({ from: () => q });
});
describe("course Zen mode API", () => {
  it.each(["tutor", "co"])("allows %s to change the course's current and future classes", async userId => {
    mocks.user.mockResolvedValue({ id: userId, email: "tutor@example.test", role: "executive" });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(mocks.db(), { courseId: id, enabled: true });
  });
  it.each(["CEO", "COO", "CEO Shadow", "COO Shadow"])("allows %s management access", async role => {
    mocks.user.mockResolvedValue({ id: "manager", email: "manager@example.test", role: "student", custom_roles: { role_level: role } });
    expect((await POST(request(), context)).status).toBe(200);
  });
  it.each([null, { id: "student", role: "student" }, { id: "another-tutor", role: "executive" }])("denies unauthorized callers on GET and POST", async user => {
    mocks.user.mockResolvedValue(user);
    expect((await GET(request(), context)).status).toBe(user ? 403 : 401);
    expect((await POST(request(), context)).status).toBe(user ? 403 : 401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects invalid bodies, foreign origins and deleted courses before applying changes", async () => {
    expect((await POST(request("false"), context)).status).toBe(400);
    expect((await POST(request(true, "https://unrelated.test"), context)).status).toBe(403);
    course.deleted_at = new Date().toISOString();
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("reports a saved preference with incomplete Discord application", async () => {
    mocks.sync.mockResolvedValue({ problems: ["Missing Permissions"] });
    const response = await POST(request(), context);
    expect(await response.json()).toEqual({ enabled: true, problems: ["Missing Permissions"] });
  });
});
