import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server side of post-course feedback (COURSE_FEEDBACK.md): who may
 * answer and when, that tutors never see names (or anything before the form
 * closes), that management does, and that the invitation email goes once.
 */

const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), bcc: vi.fn() }));
vi.mock("@/lib/authServer", () => ({
  getRequestAuthContext: mocks.context, getAdminClient: () => mocks.client(),
}));
vi.mock("@/lib/notificationsServer", () => ({ sendBccEmail: mocks.bcc }));

let studentRoute: typeof import("./course-feedback/route");
let tutorRoute: typeof import("./course-feedback/tutor/route");
let manageRoute: typeof import("./course-feedback/manage/route");
let server: typeof import("@/lib/courseFeedbackServer");

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const classAt = (ms: number) => ({ starts_at: new Date(ms).toISOString(), duration_hours: 1 });
const student = { id: "student", full_name: "Student One", email: "one@example.test", role: "student" };
const other = { id: "other", full_name: "Student Two", email: "two@example.test", role: "student" };
const tutor = { id: "tutor", full_name: "Tutor", email: "tutor@example.test", role: "executive" };
const coTutor = { id: "co", full_name: "Co Tutor", email: "co@example.test", role: "executive" };
const ceo = { id: "ceo", full_name: "Boss", email: "boss@example.test", role: "CEO" };

const course = (id: string, lastClassMs: number, extra: Row = {}) => ({
  id, title: `Course ${id}`, deleted_at: null, is_completed: false, created_by: "tutor", co_tutor_id: null,
  created_by_name: "Tutor", feedback_invited_at: null,
  course_classes: [classAt(lastClassMs - 7 * DAY), classAt(lastClassMs)], ...extra,
});

const signInAs = (user: Row, isImpersonating = false) =>
  mocks.context.mockResolvedValue({ actor: user, user, isImpersonating, impersonatedUserId: null });
const request = (body?: unknown) => new NextRequest("https://example.test/api/course-feedback", body === undefined
  ? { method: "GET" }
  : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const feedbackRows = () => tables.course_feedback;

beforeAll(async () => {
  [studentRoute, tutorRoute, manageRoute, server] = await Promise.all([
    import("./course-feedback/route"), import("./course-feedback/tutor/route"),
    import("./course-feedback/manage/route"), import("@/lib/courseFeedbackServer"),
  ]);
});
afterAll(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.bcc.mockImplementation(async (emails: string[]) => ({ sentCount: emails.length, failed: [] }));
  tables = {
    courses: [
      course("ended", NOW - DAY, { co_tutor_id: "co" }),   // form open
      course("running", NOW + 2 * DAY),                     // last class still to come
      course("old", NOW - 40 * DAY),                        // form closed
      course("elsewhere", NOW - DAY, { created_by: "someone-else" }),
    ],
    course_enrollments: [
      { id: "e1", course_id: "ended", student_id: "student", student_name: "Student One", student_email: "one@example.test" },
      { id: "e2", course_id: "ended", student_id: "other", student_name: "Student Two", student_email: "two@example.test" },
      { id: "e3", course_id: "running", student_id: "student", student_name: "Student One", student_email: "one@example.test" },
      { id: "e4", course_id: "old", student_id: "student", student_name: "Student One", student_email: "one@example.test" },
      { id: "e5", course_id: "old", student_id: "other", student_name: "Student Two", student_email: "two@example.test" },
    ],
    course_feedback: [],
    app_users: [student, other, tutor, coTutor, ceo],
  };
  tables.course_classes = tables.courses.flatMap((row) =>
    (row.course_classes as Row[]).map((lesson) => ({ ...lesson, course_id: row.id })));

  // The parts of the query builder these routes use, over in-memory rows.
  mocks.client.mockReturnValue({ from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let action = "select", values: Row = {}, span: [number, number] | null = null;
    const result = () => {
      let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (action === "update") rows.forEach((row) => Object.assign(row, values));
      if (action === "upsert") {
        const existing = tables[table].find((row) => row.course_id === values.course_id && row.student_id === values.student_id);
        if (existing) { Object.assign(existing, values); rows = [existing]; }
        else {
          const row = { id: `fb-${tables[table].length}`, created_at: new Date().toISOString(), declined_at: null, ...values };
          tables[table].push(row); rows = [row];
        }
      }
      if (span) rows = rows.slice(span[0], span[1] + 1);
      return { data: rows.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      order: () => query,
      range: (from: number, to: number) => { span = [from, to]; return query; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
      in: (key: string, list: unknown[]) => { filters.push((row) => list.includes(row[key])); return query; },
      gte: (key: string, value: string) => { filters.push((row) => String(row[key]) >= value); return query; },
      lte: (key: string, value: string) => { filters.push((row) => String(row[key]) <= value); return query; },
      update: (payload: Row) => { action = "update"; values = payload; return query; },
      upsert: (payload: Row) => { action = "upsert"; values = payload; return query; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } });
});

describe("a student's forms", () => {
  it("lists only finished courses they were in, while the form is open", async () => {
    signInAs(student);
    const body = await (await studentRoute.GET(request())).json();
    expect(body.forms.map((form: Row) => form.courseId)).toEqual(["ended"]);
    expect(body.forms[0]).toMatchObject({ title: "Course ended", answers: null, declined: false });
  });

  it("saves answers, lets them be changed, and keeps one row", async () => {
    signInAs(student);
    let response = await studentRoute.POST(request({ courseId: "ended", courseRating: 5, comments: "Great" }));
    expect(response.status).toBe(200);
    expect((await response.json()).form.answers).toMatchObject({ courseRating: 5, comments: "Great" });
    response = await studentRoute.POST(request({ courseId: "ended", courseRating: 4 }));
    expect(response.status).toBe(200);
    expect(feedbackRows()).toHaveLength(1);
    expect(feedbackRows()[0]).toMatchObject({ course_rating: 4, comments: null, student_id: "student" });
  });

  it("records No thanks with no answers", async () => {
    signInAs(student);
    await studentRoute.POST(request({ courseId: "ended", courseRating: 5 }));
    const response = await studentRoute.POST(request({ courseId: "ended", declined: true }));
    expect((await response.json()).form).toMatchObject({ declined: true, answers: null });
    expect(feedbackRows()[0]).toMatchObject({ course_rating: null, declined_at: expect.any(String) });
  });

  it.each([
    ["a course they were not in", { courseId: "elsewhere", courseRating: 5 }, 403],
    ["a course still running", { courseId: "running", courseRating: 5 }, 409],
    ["a form that has closed", { courseId: "old", courseRating: 5 }, 409],
    ["an empty form", { courseId: "ended" }, 400],
    ["no course", { courseRating: 5 }, 400],
  ])("refuses %s", async (_name, body, status) => {
    signInAs(student);
    expect((await studentRoute.POST(request(body))).status).toBe(status);
    expect(feedbackRows()).toHaveLength(0);
  });

  it("never lets management answer while viewing the site as the student", async () => {
    signInAs(student, true);
    expect((await studentRoute.POST(request({ courseId: "ended", courseRating: 1 }))).status).toBe(403);
    expect(feedbackRows()).toHaveLength(0);
  });
});

describe("what tutors see", () => {
  beforeEach(() => {
    tables.course_feedback.push(
      { id: "f1", course_id: "old", student_id: "student", course_rating: 5, tutor_rating: 5, pace: "about_right",
        another_course: "yes", next_course: "Python", comments: "Loved it", declined_at: null,
        created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
      { id: "f2", course_id: "ended", student_id: "student", course_rating: 2, tutor_rating: 1, pace: "too_fast",
        another_course: "no", next_course: null, comments: "Too fast", declined_at: null,
        created_at: "2026-11-21T20:00:00Z", updated_at: "2026-11-21T20:00:00Z" },
    );
  });

  it("shows closed courses' answers without names, and nothing for an open form", async () => {
    signInAs(tutor);
    const { courses } = await (await tutorRoute.GET(request())).json();
    const open = courses.find((item: Row) => item.courseId === "ended");
    const closed = courses.find((item: Row) => item.courseId === "old");
    expect(open).toMatchObject({ status: "open", summary: null, answers: [] });
    expect(closed.summary).toMatchObject({ responses: 1, courseRatingAverage: 5 });
    expect(closed.answers).toEqual([{
      courseRating: 5, tutorRating: 5, pace: "about_right", anotherCourse: "yes", nextCourse: "Python", comments: "Loved it",
    }]);
    const text = JSON.stringify(courses);
    for (const secret of ["student", "Student One", "f1", "f2", "Too fast", "2026-10-20"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("includes co-taught courses and refuses students", async () => {
    signInAs(coTutor);
    const { courses } = await (await tutorRoute.GET(request())).json();
    expect(courses.map((item: Row) => item.courseId)).toEqual(["ended"]);
    signInAs(student);
    expect((await tutorRoute.GET(request())).status).toBe(403);
  });

  it("gives management every response with the student's name", async () => {
    signInAs(ceo);
    const { courses } = await (await manageRoute.GET(request())).json();
    const ended = courses.find((item: Row) => item.courseId === "ended");
    expect(ended).toMatchObject({ enrolledCount: 2, status: "open" });
    expect(ended.responses).toEqual([expect.objectContaining({ studentName: "Student One", declined: false })]);
    signInAs(tutor);
    expect((await manageRoute.GET(request())).status).toBe(403);
  });
});

describe("the invitation email", () => {
  it("goes once to the students of a course that just ended", async () => {
    const first = await server.sendFeedbackInvites(mocks.client(), NOW, "America/Toronto");
    expect(first.invitedCourseIds.sort()).toEqual(["elsewhere", "ended"]);
    expect(mocks.bcc).toHaveBeenCalledTimes(1);
    expect(mocks.bcc.mock.calls[0][0].sort()).toEqual(["one@example.test", "two@example.test"]);
    expect(mocks.bcc.mock.calls[0][1]).toContain("Course ended");
    expect(tables.courses.find((row) => row.id === "ended")?.feedback_invited_at).toEqual(expect.any(String));

    const second = await server.sendFeedbackInvites(mocks.client(), NOW + 60_000, "America/Toronto");
    expect(second.invitedCourseIds).toEqual([]);
    expect(mocks.bcc).toHaveBeenCalledTimes(1);
  });

  it("is not sent for a course that ended days ago or is still running", async () => {
    tables.courses = tables.courses.filter((row) => row.id === "running" || row.id === "old");
    const result = await server.sendFeedbackInvites(mocks.client(), NOW, "America/Toronto");
    expect(result.invitedCourseIds).toEqual([]);
    expect(mocks.bcc).not.toHaveBeenCalled();
  });
});
