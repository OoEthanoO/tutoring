import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), eq: vi.fn(), gte: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestAuthContext: mocks.auth, getAdminClient: mocks.admin }));
const tutorId = "00000000-0000-4000-8000-000000000001";
const request = () => new NextRequest(`https://example.test/api/admin/recorder-diagnostics?tutorId=${tutorId}&deviceId=device`);
beforeEach(() => {
  mocks.auth.mockResolvedValue({ actor: { role: "ceo", email: "boss@example.test" } });
  mocks.single.mockResolvedValue({ data: null, error: null });
  const query = { select: () => query, eq: mocks.eq.mockImplementation(() => query), gte: mocks.gte.mockImplementation(() => query), maybeSingle: mocks.single };
  mocks.admin.mockReturnValue({ from: () => query });
});
afterEach(() => vi.clearAllMocks());
describe("leadership diagnostic access", () => {
  it.each([null, { role: "student" }, { role: "executive" }])("denies other users without reading diagnostics: %j", async (actor) => {
    mocks.auth.mockResolvedValue({ actor });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("allows management, with private uncached responses and a seven-day cutoff", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.eq).toHaveBeenCalledWith("tutor_id", tutorId);
    expect(mocks.eq).toHaveBeenCalledWith("device_id", "device");
    expect(mocks.gte.mock.calls[0][0]).toBe("received_at");
    expect(await response.json()).toEqual({ receivedAt: null, report: null });
  });
  it("uses custom-role aliases when authorizing a leadership Shadow", async () => {
    mocks.auth.mockResolvedValue({ actor: { role: "student", custom_roles: { role_level: "COO Shadow" }, email: "shadow@example.test" } });
    expect((await GET(request())).status).toBe(200);
  });
});
