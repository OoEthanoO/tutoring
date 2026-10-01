import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), breakout: vi.fn(), exercise: vi.fn(), zen: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestUser: mocks.user, getAdminClient: mocks.db }));
vi.mock("@/lib/breakoutRoomsServer", async importOriginal => ({
  ...await importOriginal<typeof import("./breakoutRoomsServer")>(), runBreakoutAction: mocks.breakout,
}));
vi.mock("@/lib/classExercisesServer", async importOriginal => ({
  ...await importOriginal<typeof import("./classExercisesServer")>(), mutateExercise: mocks.exercise,
}));
vi.mock("@/lib/zenModeServer", async importOriginal => ({
  ...await importOriginal<typeof import("./zenModeServer")>(), syncZenMode: mocks.zen,
}));

import { POST as breakout } from "@/app/api/classes/[classId]/breakout-rooms/route";
import { POST as exercise } from "@/app/api/class-exercises/[classId]/route";
import { POST as zen } from "@/app/api/courses/[courseId]/zen-mode/route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ classId: id, courseId: id }) };
const handlers = [
  { name: "breakout rooms", post: breakout, path: `/api/classes/${id}/breakout-rooms` },
  { name: "student exercise submissions", post: exercise, path: `/api/class-exercises/${id}` },
  { name: "Zen mode", post: zen, path: `/api/courses/${id}/zen-mode` },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://learn.ethanyanxu.com/");
  mocks.user.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe.each(handlers)("$name through Caddy", ({ post, path }) => {
  it.each(["https://learn.ethanyanxu.com", null])("passes the origin check but still requires a signed-in user (%s)", async origin => {
    const request = new NextRequest(`http://127.0.0.1:3101${path}`, {
      method: "POST", headers: origin ? { origin } : {}, body: "{}",
    });
    const response = await post(request, context);
    expect(response.status).toBe(401);
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.breakout).not.toHaveBeenCalled();
    expect(mocks.exercise).not.toHaveBeenCalled();
    expect(mocks.zen).not.toHaveBeenCalled();
  });
  it("blocks an unrelated website before authentication or any mutation", async () => {
    const request = new NextRequest(`http://127.0.0.1:3101${path}`, {
      method: "POST", headers: { origin: "https://unrelated.example", "x-forwarded-host": "unrelated.example", "x-forwarded-proto": "https" }, body: "{}",
    });
    const response = await post(request, context);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.breakout).not.toHaveBeenCalled();
    expect(mocks.exercise).not.toHaveBeenCalled();
    expect(mocks.zen).not.toHaveBeenCalled();
  });
});
