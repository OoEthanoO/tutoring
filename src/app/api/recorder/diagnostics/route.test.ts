import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), eq: vi.fn(), upsert: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getAdminClient: mocks.admin }));
vi.mock("@/lib/recorderAuth", () => ({ getRecorderUser: mocks.user }));
const post = (overrides = {}) => POST(new NextRequest("https://example.test/api/recorder/diagnostics", {
  method: "POST", body: JSON.stringify({ deviceId: "my-device", report: { schema: 1, state: "idle" }, ...overrides }),
}));
beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "my-user" });
  mocks.single.mockResolvedValue({ data: { device_id: "my-device" }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  const query = { select: () => query, eq: mocks.eq.mockImplementation(() => query), maybeSingle: mocks.single, upsert: mocks.upsert };
  mocks.admin.mockReturnValue({ from: () => query });
});
afterEach(() => vi.clearAllMocks());
describe("recorder diagnostic upload", () => {
  it("requires a signed-in tutor", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("cannot write another tutor's report or spoof its server receipt time", async () => {
    expect((await post({ tutorId: "other-user", received_at: "bad" })).status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith("tutor_id", "my-user");
    expect(mocks.eq).toHaveBeenCalledWith("device_id", "my-device");
    expect(mocks.upsert.mock.calls[0][0].tutor_id).toBe("my-user");
    expect(mocks.upsert.mock.calls[0][0].received_at).not.toBe("bad");
  });
  it("requires a previously registered device owned by the tutor", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await post()).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects malformed and test-mode reports", async () => {
    expect((await post({ report: { schema: 1, state: "test" } })).status).toBe(400);
    expect((await post({ deviceId: {} })).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
