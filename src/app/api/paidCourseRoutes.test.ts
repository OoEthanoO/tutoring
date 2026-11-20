import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server side of the paid-course rules (PAID_COURSES.md): who can confirm
 * a payment, that approval waits for it, and that enrolling in a paid course
 * needs someone to pay.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(), context: vi.fn(), client: vi.fn(), email: vi.fn(), founders: vi.fn(), discord: vi.fn(), tutors: vi.fn(),
}));
vi.mock("@/lib/authServer", () => ({
  getRequestUser: mocks.user, getRequestAuthContext: mocks.context, getAdminClient: () => mocks.client(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("@/lib/notificationsServer", () => ({
  sendEmail: mocks.email, notifyFounders: mocks.founders, sendDiscordMessageByChannelName: mocks.discord,
  executivesChannelName: () => "executives",
}));
vi.mock("@/lib/courseChangeNotifications", () => ({ notifyCourseTutorsOfNewEnrollment: mocks.tutors }));

let decide: typeof import("./enrollments/[requestId]/route");
let enroll: typeof import("./courses/[courseId]/enroll/route");
let confirm: typeof import("./paid-enrollments/route");
let manual: typeof import("./admin/enrollments/route");

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const requestId = "11111111-1111-4111-8111-111111111111";
const submittedAt = "2026-11-20T12:00:00.000Z";
const student = { id: "student", full_name: "Applicant", email: "applicant@example.test", role: "student" };
const tutor = { id: "tutor", full_name: "Tutor", email: "tutor@example.test", role: "executive" };
const application = {
  guardianEmail: "guardian@example.test", studentFullName: "Applicant", schoolName: "School", grade: "8",
  parentGuardianName: "Guardian", parentGuardianPhone: "1234567890", consentName: "Guardian",
};
const json = (body: unknown, method: string) => new NextRequest("https://example.test/api/test", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const pendingRequest = () => tables.course_enrollment_requests[0];
const signInAs = (user: Row, isImpersonating = false) => {
  mocks.user.mockResolvedValue(user);
  mocks.context.mockResolvedValue({ actor: user, user, isImpersonating, impersonatedUserId: null });
};

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
  [decide, enroll, confirm, manual] = await Promise.all([
    import("./enrollments/[requestId]/route"), import("./courses/[courseId]/enroll/route"),
    import("./paid-enrollments/route"), import("./admin/enrollments/route"),
  ]);
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email.mockResolvedValue(true);
  mocks.founders.mockResolvedValue(undefined);
  mocks.discord.mockResolvedValue(true);
  tables = {
    courses: [{
      id: "course", title: "Paid Coding", max_students: 10, is_paid: true, paid_fee: 60, deleted_at: null,
      created_by: "tutor", created_by_email: "tutor@example.test", is_co_taught: false, co_tutor_id: null,
      course_classes: [{ starts_at: "2099-01-01T12:00:00Z" }], course_enrollments: [{ count: 0 }],
    }],
    course_enrollment_requests: [{
      id: requestId, course_id: "course", student_id: student.id, student_name: student.full_name,
      student_email: student.email, status: "pending", created_at: submittedAt, decided_at: null,
      rejection_reason: null, payment_confirmed_at: null, payment_confirmed_by: null,
    }],
    course_enrollments: [], student_applications: [],
    app_users: [{ ...student }, { ...tutor, senior_tutor: true, discord_user_id: "123" }],
    tutor_profiles: [{ user_id: "tutor", payment_note: "e-Transfer to the tutor" }],
  };
  // The parts of the query builder these routes use, over in-memory rows.
  mocks.client.mockReturnValue({ from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let action = "select", values: Row = {};
    const result = () => {
      let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (action === "update") rows.forEach((row) => Object.assign(row, values));
      if (action === "insert" || action === "upsert") {
        const existing = action === "upsert" && tables[table]?.find(
          (row) => row.course_id === values.course_id && row.student_id === values.student_id
        );
        if (existing) { Object.assign(existing, values); rows = [existing]; }
        else { const row = { id: `new-${tables[table].length}`, created_at: new Date().toISOString(), ...values }; tables[table].push(row); rows = [row]; }
      }
      return {
        data: rows.map((row) => ({
          ...row,
          ...(table === "course_enrollment_requests" ? { course: tables.courses.find((course) => course.id === row.course_id) } : {}),
        })),
        error: null,
      };
    };
    const query = {
      select: () => query,
      order: () => query,
      or: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
      in: (key: string, list: unknown[]) => { filters.push((row) => list.includes(row[key])); return query; },
      update: (payload: Row) => { action = "update"; values = payload; return query; },
      insert: (payload: Row) => { action = "insert"; values = payload; return query; },
      upsert: (payload: Row) => { action = "upsert"; values = payload; return query; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      single: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } });
});

describe("confirming a payment", () => {
  const mark = (body: unknown) => confirm.PATCH(json(body, "PATCH"));

  it("lets the course's own tutor mark a payment as received and tells management once", async () => {
    signInAs(tutor);
    const response = await mark({ requestId, received: true, submittedAt });
    expect(response.status).toBe(200);
    expect(pendingRequest().payment_confirmed_at).toEqual(expect.any(String));
    expect(pendingRequest().payment_confirmed_by).toBe("tutor");
    expect(mocks.founders).toHaveBeenCalledOnce();
    // Confirming again changes nothing that management needs to hear about.
    await mark({ requestId, received: true, submittedAt });
    expect(mocks.founders).toHaveBeenCalledOnce();
  });

  it("lets the tutor undo it", async () => {
    signInAs(tutor);
    await mark({ requestId, received: true, submittedAt });
    expect((await mark({ requestId, received: false, submittedAt })).status).toBe(200);
    expect(pendingRequest().payment_confirmed_at).toBeNull();
    expect(pendingRequest().payment_confirmed_by).toBeNull();
  });

  it.each([
    ["another tutor", { ...tutor, id: "other-tutor" }],
    ["management", { ...tutor, id: "reviewer", role: "CEO" }],
    ["the student", student],
  ])("hides the request from %s", async (_label, user) => {
    signInAs(user);
    expect((await mark({ requestId, received: true, submittedAt })).status).toBe(404);
    expect(pendingRequest().payment_confirmed_at).toBeNull();
  });

  it("refuses management viewing the site as the tutor", async () => {
    signInAs(tutor, true);
    expect((await mark({ requestId, received: true, submittedAt })).status).toBe(403);
    expect(pendingRequest().payment_confirmed_at).toBeNull();
  });

  it("refuses a signed-out visitor, a malformed request and a cross-site request", async () => {
    mocks.context.mockResolvedValue({ actor: null, user: null, isImpersonating: false, impersonatedUserId: null });
    expect((await mark({ requestId, received: true })).status).toBe(401);
    signInAs(tutor);
    expect((await mark({ requestId: "not-an-id", received: true })).status).toBe(400);
    expect((await mark({ requestId, received: "yes" })).status).toBe(400);
    const crossSite = new NextRequest("https://example.test/api/paid-enrollments", {
      method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://elsewhere.example" },
      body: JSON.stringify({ requestId, received: true }),
    });
    expect((await confirm.PATCH(crossSite)).status).toBe(403);
    expect(pendingRequest().payment_confirmed_at).toBeNull();
  });

  it("refuses a decided request, a course that is not paid and a stale application", async () => {
    signInAs(tutor);
    expect((await mark({ requestId, received: true, submittedAt: "2026-11-01T00:00:00.000Z" })).status).toBe(409);
    pendingRequest().status = "approved";
    expect((await mark({ requestId, received: true, submittedAt })).status).toBe(400);
    pendingRequest().status = "pending";
    tables.courses[0].is_paid = false;
    expect((await mark({ requestId, received: true, submittedAt })).status).toBe(400);
    expect(pendingRequest().payment_confirmed_at).toBeNull();
  });
});

describe("approving an enrollment in a paid course", () => {
  const review = (action: string) =>
    decide.PATCH(json({ action, submittedAt }, "PATCH"), { params: { requestId } });

  beforeEach(() => signInAs({ ...student, id: "reviewer", role: "COO" }));

  it.each(["approve", "expand_and_approve"])("refuses %s until the tutor has confirmed the payment", async (action) => {
    const response = await review(action);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("mark the payment as received");
    expect(tables.course_enrollments).toHaveLength(0);
    expect(pendingRequest().status).toBe("pending");
  });

  it("approves once the payment is confirmed", async () => {
    pendingRequest().payment_confirmed_at = "2026-11-20T15:00:00.000Z";
    expect((await review("approve")).status).toBe(200);
    expect(tables.course_enrollments).toHaveLength(1);
    expect(pendingRequest().status).toBe("approved");
  });

  it("never holds up a course that is not paid", async () => {
    tables.courses[0].is_paid = false;
    expect((await review("approve")).status).toBe(200);
    expect(tables.course_enrollments).toHaveLength(1);
  });

  it("does not let management add a student to a paid course by hand", async () => {
    const response = await manual.POST(json({ userId: student.id, courseId: "course" }, "POST"));
    expect(response.status).toBe(400);
    expect(tables.course_enrollments).toHaveLength(0);
  });
});

describe("applying to a paid course", () => {
  const submit = () => enroll.POST(json(application, "POST"), { params: { courseId: "course" } });

  beforeEach(() => {
    signInAs(student);
    tables.course_enrollment_requests = [];
  });

  it("creates the request and tells the tutor, with the family's names by email only", async () => {
    expect((await submit()).status).toBe(200);
    expect(tables.course_enrollment_requests).toHaveLength(1);
    const tutorEmail = mocks.email.mock.calls.find(([to]) => to === tutor.email)!;
    expect(tutorEmail[2]).toContain("Guardian");
    expect(tutorEmail[2]).toContain("$60");
    expect(mocks.discord).toHaveBeenCalledOnce();
    const [, content] = mocks.discord.mock.calls[0];
    expect(content).toContain("<@123>");
    expect(content).not.toContain("Applicant");
    expect(content).not.toContain("Guardian");
  });

  it("clears an earlier confirmation when the family applies again", async () => {
    tables.course_enrollment_requests = [{
      id: requestId, course_id: "course", student_id: student.id, student_name: student.full_name,
      student_email: student.email, status: "rejected", created_at: submittedAt, decided_at: submittedAt,
      rejection_reason: "Wrong grade", payment_confirmed_at: "2026-11-20T15:00:00.000Z", payment_confirmed_by: "tutor",
    }];
    expect((await submit()).status).toBe(200);
    expect(pendingRequest()).toMatchObject({ status: "pending", payment_confirmed_at: null, payment_confirmed_by: null });
  });

  it.each([
    ["the tutor is no longer a senior tutor", () => { tables.app_users[1].senior_tutor = false; }],
    ["the tutor has no payment note", () => { tables.tutor_profiles = []; }],
    ["the course has no tutor", () => { tables.courses[0].created_by = null; }],
  ])("stays closed when %s", async (_label, arrange) => {
    arrange();
    const response = await submit();
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("not open yet");
    expect(tables.course_enrollment_requests).toHaveLength(0);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("leaves an ordinary course exactly as before", async () => {
    tables.courses[0].is_paid = false;
    tables.app_users[1].senior_tutor = false;
    expect((await submit()).status).toBe(200);
    expect(mocks.discord).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
