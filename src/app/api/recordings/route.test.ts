import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const auth = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestUser: auth.user, getAdminClient: auth.client }));

const classFour = {
  id: "original", class_id: "class-4", course_id: "robotics", tutor_id: "tutor",
  status: "ready", size_bytes: 123456789, duration_seconds: 3720,
  recording_started_at: "2026-09-09T19:00:00Z", recording_ended_at: "2026-09-09T20:02:00Z",
  uploaded_at: "2026-09-09T20:05:00Z", expires_at: "2026-09-16T20:05:00Z",
  course: { title: "Intro to High School Robotics - Programming", created_by: "tutor", co_tutor_id: null, created_by_name: "Tutor" },
  class: { title: "Class 4", starts_at: "2026-09-09T19:00:00Z" },
};

const setup = (rows: Array<typeof classFour>) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T20:00:00Z"));
  auth.user.mockResolvedValue({ id: "student", email: "student@example.test", role: "student" });
  auth.client.mockReturnValue({
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query, gt: () => query, order: () => query, limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: table === "class_recordings" ? rows : [{ course_id: "robotics" }], error: null,
        }).then(resolve),
      };
      return query;
    },
  });
};
const request = () => new NextRequest("https://example.test/api/recordings");
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("recordings list", () => {
  it("returns Class 5 and one Class 4 entry for the duplicate-upload scenario", async () => {
    setup([
      { ...classFour, id: "class-five", class_id: "class-5", class: { title: "Class 5", starts_at: "2026-09-10T19:00:00Z" } },
      { ...classFour, id: "duplicate", uploaded_at: "2026-09-09T20:10:00Z" },
      classFour,
    ]);
    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.recordings.map((row: { id: string }) => row.id)).toEqual(["class-five", "original"]);
    expect(data.recordings[1].durationSeconds).toBe(3720);
    expect(data.recordings[1].expiresAt).toBe(classFour.expires_at);
    expect(data.recordings[1].viewerRole).toBe("student");
    expect(data.recordings[1]).not.toHaveProperty("size_bytes");
    expect(data.recordings[1]).not.toHaveProperty("recording_started_at");
  });

  it("keeps co-tutor and separate-part recordings accessible", async () => {
    setup([
      classFour,
      { ...classFour, id: "co-tutor", tutor_id: "another-tutor" },
      { ...classFour, id: "part-two", recording_started_at: "2026-09-09T19:30:00Z" },
    ]);
    expect((await (await GET(request())).json()).recordings).toHaveLength(3);
  });

  it("still excludes expired, unfinished, and unenrolled recordings", async () => {
    setup([
      classFour,
      { ...classFour, id: "expired", expires_at: "2026-09-11T20:05:00Z" },
      { ...classFour, id: "unfinished", status: "uploading" },
      { ...classFour, id: "private-course", class_id: "private-class", course_id: "not-enrolled" },
    ]);
    const data = await (await GET(request())).json();
    expect(data.recordings.map((row: { id: string }) => row.id)).toEqual(["original"]);
  });

  it("requires sign-in", async () => {
    setup([classFour]);
    auth.user.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });
});
