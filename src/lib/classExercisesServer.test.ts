import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "./authServer";
const mocks = vi.hoisted(() => ({ getAdminClient: vi.fn(), getRequestUser: vi.fn(), getRecorderUser: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getAdminClient: mocks.getAdminClient, getRequestUser: mocks.getRequestUser }));
vi.mock("@/lib/recorderAuth", () => ({ getRecorderUser: mocks.getRecorderUser }));
vi.mock("@/lib/notificationsServer", () => ({ sendDiscordCourseRoleMessage: mocks.announce }));
import { GET as studentGet, POST as studentPost } from "@/app/api/class-exercises/[classId]/route";
import { GET as tutorGet, POST as tutorPost } from "@/app/api/recorder/exercises/[classId]/route";

const classId = "01234567-1234-1234-1234-012345678901";
const questionId = "01234567-1234-1234-1234-012345678902";
const user = { id: "student-id", email: "student@example.test", role: "student" } as SessionUser;
const lesson = { id: classId, title: "Class 1", starts_at: "2026-09-13T20:00:00Z", course: { id: "course", title: "Python", created_by: "tutor-id", co_tutor_id: "co-tutor-id", deleted_at: null } };
type Query = { table: string; filters: Record<string, unknown>; select: string };
let queries: Query[];
let enrolled: boolean;
let dbError: unknown;
const rpc = vi.fn();
const context = { params: Promise.resolve({ classId }) };
const request = (body?: unknown) => new NextRequest(`https://learn.ethanyanxu.com/api/class-exercises/${classId}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});

beforeEach(() => {
  vi.clearAllMocks(); queries = []; enrolled = true; dbError = null;
  mocks.getRequestUser.mockResolvedValue(user);
  mocks.getRecorderUser.mockResolvedValue({ ...user, id: "tutor-id", role: "executive" });
  mocks.announce.mockResolvedValue(true);
  rpc.mockResolvedValue({ data: null, error: null });
  mocks.getAdminClient.mockReturnValue({ rpc, from: (table: string) => {
    const q: Query = { table, filters: {}, select: "" }; queries.push(q);
    const result = () => ({ error: dbError, data: table === "course_classes" ? lesson
      : table === "course_enrollments" ? (enrolled ? { id: "enrolled" } : null)
      : table === "class_exercise_rooms" ? { current_question_id: questionId, announced_at: "2026-09-13" }
      : table === "class_exercise_questions" ? [{ id: questionId, class_id: classId, number: 1, prompt: "Hello", opened_at: "2026-09-13T20:00:00Z", closes_at: "2026-09-13T20:03:00Z", stopped_at: null }]
      : table === "class_exercise_submissions" ? ["student-id", "someone-else"].filter(id => !q.filters.student_id || q.filters.student_id === id).map((id, index) => ({ id: `submission-${index}`, question_id: questionId, student_id: id, answer: "private code", status: "pending", attempt: 1, ...(q.select.includes("app_users") ? { student: { full_name: "Student Name", email: "private@example.test" } } : {}) })) : [] });
    const builder = {
      select: (value: string) => { q.select = value; return builder; },
      eq: (key: string, value: unknown) => { q.filters[key] = value; return builder; },
      in: (key: string, value: unknown) => { q.filters[key] = value; return builder; },
      order: () => builder, range: () => builder, maybeSingle: () => Promise.resolve(result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  } });
});

describe("private exercise endpoints", () => {
  it("filters students in the database and never embeds classmates' identities", async () => {
    const response = await studentGet(request(), context); const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(data.submissions).toHaveLength(1);
    expect(data.submissions[0].student_id).toBe(user.id);
    const query = queries.find(q => q.table === "class_exercise_submissions")!;
    expect(query.filters.student_id).toBe(user.id); expect(query.select).not.toContain("app_users");
    expect(JSON.stringify(data)).not.toContain("someone-else");
  });
  it("gives the course tutor named submissions", async () => {
    const response = await tutorGet(request(), context); const data = await response.json();
    expect(response.status).toBe(200); expect(data.submissions).toHaveLength(2);
    expect(data.submissions[0].studentName).toBe("Student Name");
  });
  it("blocks an unrelated tutor, even if enrolled as a student", async () => {
    mocks.getRecorderUser.mockResolvedValue({ ...user, role: "executive" });
    expect((await tutorGet(request(), context)).status).toBe(403);
    expect(queries.some(q => q.table === "class_exercise_submissions")).toBe(false);
  });
  it("allows the co-tutor and leadership Shadows to manage", async () => {
    for (const actor of [{ ...user, id: "co-tutor-id", role: "executive" }, { ...user, role: "CEO Shadow" }]) {
      mocks.getRecorderUser.mockResolvedValue(actor);
      expect((await tutorGet(request(), context)).status).toBe(200);
    }
  });
  it("rejects non-enrolled students and expired sessions without reading answers", async () => {
    enrolled = false;
    expect((await studentGet(request(), context)).status).toBe(403);
    mocks.getRequestUser.mockResolvedValue(null);
    expect((await studentGet(request(), context)).status).toBe(401);
    mocks.getRecorderUser.mockResolvedValue(null);
    expect((await tutorGet(request(), context)).status).toBe(401);
    expect(queries.some(q => q.table === "class_exercise_submissions")).toBe(false);
  });
  it("fails closed on database lookup failures", async () => {
    dbError = { message: "database unavailable" };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await studentGet(request(), context)).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled(); quiet.mockRestore();
  });
  it("ignores a forged student identity and preserves the exact answer", async () => {
    const answer = "\n\tdef hi():\n    return 1\n";
    const response = await studentPost(request({ action: "submit", id: questionId, questionId, answer, student_id: "someone-else" }), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("class_exercise_action", expect.objectContaining({ p_actor: user.id, p_action: "submit", p_input: expect.objectContaining({ answer }) }));
  });
  it("rejects grading/stop/announcement RPC actions on the student endpoint", async () => {
    for (const action of ["grade", "publish", "stop", "announce", "finish_announcement"]) expect((await studentPost(request({ action }), context)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns database deadline failures as a conflict", async () => {
    rpc.mockResolvedValue({ error: { code: "P0001", message: "This question is closed." } });
    const response = await studentPost(request({ action: "submit", id: questionId, questionId, answer: "Hi" }), context);
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("closed");
  });
  it("announces the stable class link only after claiming it", async () => {
    rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "claim_announcement" ? "2026-09-13T00:00:00Z" : null, error: null }));
    expect((await tutorPost(request({ action: "publish", id: questionId, prompt: "Hello", durationSeconds: 180 }), context)).status).toBe(200);
    const [courseId, content, options] = mocks.announce.mock.calls[0];
    expect(courseId).toBe("course"); expect(content("role123")).toContain(`<@&role123>`);
    expect(content("role123")).toContain(`/class-exercises/${classId}`);
    expect(content("role123")).not.toContain(questionId);
    expect(options.nonce.length).toBeLessThanOrEqual(25);
    mocks.announce.mockClear(); rpc.mockResolvedValue({ data: false, error: null });
    await tutorPost(request({ action: "announce" }), context); expect(mocks.announce).not.toHaveBeenCalled();
  });
  it("surfaces Discord failures after saving without losing the question", async () => {
    rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_action === "claim_announcement" ? "claim" : null, error: null }));
    mocks.announce.mockResolvedValue(false);
    const response = await tutorPost(request({ action: "publish", id: questionId, prompt: "Hello", durationSeconds: 180 }), context);
    expect(response.status).toBe(502); expect((await response.json()).error).toContain("question is live");
    expect(rpc).toHaveBeenCalledWith("class_exercise_action", expect.objectContaining({ p_action: "finish_announcement", p_input: { claim: "claim", sent: false } }));
  });
});
