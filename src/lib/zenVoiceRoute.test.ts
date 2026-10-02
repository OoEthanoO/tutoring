import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getAdminClient: mocks.db }));
vi.mock("@/lib/zenModeServer", () => ({ syncZenMode: mocks.sync, ZenBusyError: class extends Error {} }));
import { POST } from "@/app/api/internal/zen-voice/route";
import { ZenBusyError } from "./zenModeServer";
const id = "123456789012345678";
const request = (body: unknown, authorized = true) => new NextRequest("http://localhost/api/internal/zen-voice", {
  method: "POST", body: JSON.stringify(body), headers: authorized ? { authorization: "Bearer test-only-secret" } : {},
});
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "test-only-secret"); mocks.db.mockReturnValue({}); });
afterEach(() => vi.unstubAllEnvs());
describe("Gateway voice update endpoint", () => {
  it("rejects unauthenticated calls before touching the database", async () => {
    expect((await POST(request({ memberIds: [id] }, false))).status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs and oversized batches", async () => {
    for (const memberIds of [[], ["../members"], Array(21).fill(id)]) {
      expect((await POST(request({ memberIds }))).status).toBe(400);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("only requests current-state reconciliation for the supplied member IDs", async () => {
    mocks.sync.mockResolvedValue({ problems: [] });
    expect((await POST(request({ memberIds: [id], mute: false }))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith({}, undefined, { memberIds: [id], voicesOnly: true });
  });
  it("tells the worker to retry busy or failed mutations", async () => {
    mocks.sync.mockRejectedValueOnce(new ZenBusyError());
    expect((await POST(request({ memberIds: [id] }))).status).toBe(409);
    mocks.sync.mockResolvedValueOnce({ problems: ["Discord unavailable"] });
    expect((await POST(request({ memberIds: [id] }))).status).toBe(503);
  });
});
