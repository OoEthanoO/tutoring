import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), email: vi.fn(), founders: vi.fn(), tutors: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestUser: mocks.user }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("@/lib/notificationsServer", () => ({ sendEmail: mocks.email, notifyFounders: mocks.founders }));
vi.mock("@/lib/courseChangeNotifications", () => ({ notifyCourseTutorsOfNewEnrollment: mocks.tutors }));

let decide: typeof import("./[requestId]/route");
let enroll: typeof import("../courses/[courseId]/enroll/route");
let list: typeof import("./route");
let enrolled: typeof import("../enrolled/route");
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failure: string | null;
let beforeWrite: (() => void) | null;
const writes = vi.fn();
const student = { id: "student", full_name: "Applicant", email: "applicant@example.test", role: "student" };
const submittedAt = "2026-09-10T12:00:00.000Z";
const application = { guardianEmail: "guardian@example.test", studentFullName: "Applicant", schoolName: "Updated school", grade: "8", parentGuardianName: "Guardian", parentGuardianPhone: "1234567890", consentName: "Guardian" };
const request = (body: unknown, method = "PATCH") => new NextRequest("https://example.test/api/enrollments/request", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const review = (body: unknown) => decide.PATCH(request(body), { params: { requestId: "request" } });
const submit = (body: unknown = application) => enroll.POST(request(body, "POST"), { params: { courseId: "course" } });

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-fixture");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
  [decide, enroll, list, enrolled] = await Promise.all([
    import("./[requestId]/route"), import("../courses/[courseId]/enroll/route"), import("./route"), import("../enrolled/route"),
  ]);
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks(); failure = null; beforeWrite = null;
  mocks.user.mockResolvedValue({ ...student, id: "reviewer", role: "CEO Shadow" });
  mocks.email.mockResolvedValue(true);
  tables = {
    courses: [{ id: "course", title: 'Coding <script>bad()</script> & "more"', max_students: 10,
      created_by: "tutor", created_by_email: "tutor@example.test", course_classes: [{ starts_at: "2099-01-01T12:00:00Z" }], course_enrollments: [{ count: 0 }] }],
    course_enrollment_requests: [{ id: "request", course_id: "course", student_id: student.id, student_name: student.full_name,
      student_email: student.email, status: "pending", created_at: submittedAt, decided_at: null, rejection_reason: null }],
    course_enrollments: [], student_applications: [], app_users: [{ ...student }], tutor_profiles: [],
  };
  mocks.client.mockReturnValue({ from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let action = "select", values: Row = {}, ordering: { key: string; ascending: boolean } | null = null;
    const result = () => {
      if (failure === `${table}:${action}`) return { data: null, error: { message: "Database unavailable" } };
      if (action !== "select") { beforeWrite?.(); beforeWrite = null; }
      let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (action === "update") rows.forEach(row => Object.assign(row, values));
      if (action === "insert" || action === "upsert") {
        const existing = action === "upsert" && tables[table]?.find(row => row.course_id === values.course_id && row.student_id === values.student_id);
        if (existing) { Object.assign(existing, values); rows = [existing]; }
        else { const row = { id: `new-${tables[table].length}`, created_at: new Date().toISOString(), ...values }; tables[table].push(row); rows = [row]; }
      }
      if (action !== "select") writes(table, action, structuredClone(values), rows.length);
      if (ordering) { const { key, ascending } = ordering; rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1)); }
      return { data: rows.map(row => ({ ...row, ...(["course_enrollment_requests", "course_enrollments"].includes(table)
        ? { course: tables.courses.find(course => course.id === row.course_id) } : {}) })), error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: (key: string, options: { ascending: boolean }) => { ordering = { key, ascending: options.ascending }; return query; },
      update: (payload: Row) => { action = "update"; values = payload; return query; },
      insert: (payload: Row) => { action = "insert"; values = payload; return query; },
      upsert: (payload: Row) => { action = "upsert"; values = payload; return query; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      single: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } });
});

describe("enrollment rejection", () => {
  it.each(["founder", "CEO", "COO", "CEO Shadow", "COO Shadow"])("allows %s to reject with a required, safely rendered email reason", async role => {
    mocks.user.mockResolvedValue({ ...student, id: "reviewer", role });
    const reason = "Please correct <img src=x onerror=bad()>\n    Then reapply & retry.";
    const response = await review({ action: "reject", rejectionReason: `  ${reason}  `, submittedAt });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ emailSent: true, request: { status: "rejected", rejection_reason: reason } });
    expect(tables.course_enrollment_requests[0].rejection_reason).toBe(reason);
    expect(mocks.email).toHaveBeenCalledOnce();
    const [to, , html] = mocks.email.mock.calls[0];
    expect(to).toBe(student.email); expect(to).not.toBe(application.guardianEmail);
    expect(html).toContain("&lt;img src=x onerror=bad()&gt;<br>    Then reapply &amp; retry.");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img");
    expect(html).toContain("submit a new enrollment request");
    expect(tables.course_enrollments).toHaveLength(0);
  });
  it.each([null, "student", "executive"])("denies unauthorized reviewer %s without sending or changing anything", async role => {
    mocks.user.mockResolvedValue(role ? { ...student, role } : null);
    expect((await review({ action: "reject", rejectionReason: "Reason" })).status).toBe(role ? 403 : 401);
    expect(writes).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled();
  });
  it.each([undefined, "", " \n ", 15, {}, "x".repeat(2001)])("rejects an invalid reason before writing: %j", async reason => {
    expect((await review({ action: "reject", rejectionReason: reason })).status).toBe(400);
    expect(writes).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled();
  });
  it("reports email failure while retaining the rejection and reason", async () => {
    mocks.email.mockResolvedValue(false);
    const response = await review({ action: "reject", rejectionReason: "Correct your application" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ emailSent: false, request: { status: "rejected", rejection_reason: "Correct your application" } });
  });
  it("waits for the email send before returning", async () => {
    let finish!: (value: boolean) => void;
    mocks.email.mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
    let returned = false;
    const pending = review({ action: "reject", rejectionReason: "Please correct your grade" }).then(response => { returned = true; return response; });
    await vi.waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    finish(true); expect((await pending).status).toBe(200);
  });
  it("does not send another rejection email for an already processed request", async () => {
    await review({ action: "reject", rejectionReason: "Reason" });
    expect((await review({ action: "reject", rejectionReason: "Another reason" })).status).toBe(400);
    expect(mocks.email).toHaveBeenCalledOnce();
  });
  it("rejects a stale review after the student has submitted again", async () => {
    tables.course_enrollment_requests[0].created_at = "2026-09-11T12:00:00.000Z";
    expect((await review({ action: "approve", submittedAt })).status).toBe(409);
    expect(writes).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled();
  });
  it("does not send mail if the decision loses a concurrent status change", async () => {
    beforeWrite = () => { tables.course_enrollment_requests[0].status = "approved"; };
    expect((await review({ action: "reject", rejectionReason: "Reason" })).status).toBe(409);
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("clears the rejection reason when a rejected request is approved", async () => {
    Object.assign(tables.course_enrollment_requests[0], { status: "rejected", rejection_reason: "Old reason" });
    expect((await review({ action: "approve" })).status).toBe(200);
    expect(tables.course_enrollment_requests[0]).toMatchObject({ status: "approved", rejection_reason: null });
    expect(tables.course_enrollments).toHaveLength(1);
  });
});

describe("re-enrollment", () => {
  beforeEach(() => {
    mocks.user.mockResolvedValue(student);
    Object.assign(tables.course_enrollment_requests[0], { status: "rejected", rejection_reason: "Old reason", decided_at: submittedAt });
  });
  it("lets an ordinary student reapply, clearing the previous decision and refreshing the application", async () => {
    const response = await submit();
    expect(response.status).toBe(200);
    expect(tables.course_enrollment_requests).toHaveLength(1);
    expect(tables.course_enrollment_requests[0]).toMatchObject({ status: "pending", rejection_reason: null, decided_at: null });
    expect(tables.course_enrollment_requests[0].created_at).not.toBe(submittedAt);
    expect(tables.student_applications[0]).toMatchObject({ school_name: "Updated school", guardian_email: application.guardianEmail });
    expect(mocks.founders).toHaveBeenCalledOnce(); expect(mocks.email).not.toHaveBeenCalled();
    expect((await submit()).status).toBe(400);
    expect(tables.student_applications).toHaveLength(1);
  });
  it("allows legacy rejected requests that have no stored reason", async () => {
    tables.course_enrollment_requests[0].rejection_reason = null;
    expect((await submit()).status).toBe(200);
  });
  it.each([{}, { ...application, studentFullName: "   " }])("preserves the old decision if application validation fails", async body => {
    expect((await submit(body)).status).toBe(400);
    expect(tables.course_enrollment_requests[0]).toMatchObject({ status: "rejected", rejection_reason: "Old reason" });
    expect(writes).not.toHaveBeenCalled();
  });
  it("preserves the old decision if saving the new application fails", async () => {
    failure = "student_applications:insert";
    expect((await submit()).status).toBe(500);
    expect(tables.course_enrollment_requests[0]).toMatchObject({ status: "rejected", rejection_reason: "Old reason" });
    expect(mocks.founders).not.toHaveBeenCalled();
  });
  it.each(["course_enrollments:select", "course_enrollment_requests:select"])("does not submit when a lookup fails: %s", async lookup => {
    failure = lookup;
    expect((await submit()).status).toBe(500); expect(writes).not.toHaveBeenCalled();
  });
  it.each(["full", "closed", "enrolled", "pending"])("still blocks applications when %s", async condition => {
    if (condition === "full") tables.courses[0].course_enrollments = [{ count: 10 }];
    if (condition === "closed") tables.courses[0].course_classes = [{ starts_at: "2000-01-01T12:00:00Z" }];
    if (condition === "enrolled") tables.course_enrollments.push({ id: "enrolled", student_id: student.id, course_id: "course" });
    if (condition === "pending") tables.course_enrollment_requests[0].status = "pending";
    expect((await submit()).status).toBe(400); expect(writes).not.toHaveBeenCalled();
  });
  it("shows management the newest form, with the stored rejection reason", async () => {
    mocks.user.mockResolvedValue({ ...student, role: "COO" });
    tables.student_applications.push(
      { id: "old", course_id: "course", student_id: student.id, created_at: "2026-09-01T00:00:00Z" },
      { id: "new", course_id: "course", student_id: student.id, created_at: "2026-09-12T00:00:00Z" },
    );
    const response = await list.GET(new NextRequest("https://example.test/api/enrollments"));
    expect((await response.json()).requests[0]).toMatchObject({ rejection_reason: "Old reason", student_application: { id: "new" } });
  });
  it("shows students only their own rejection reason", async () => {
    tables.course_enrollment_requests.push({ id: "other", student_id: "other", course_id: "course", status: "rejected", rejection_reason: "Private other reason" });
    const response = await enrolled.GET(new NextRequest("https://example.test/api/enrolled"));
    const body = await response.json();
    expect(body.courses).toHaveLength(1);
    expect(body.courses[0].enrollment_rejection_reason).toBe("Old reason");
    expect(JSON.stringify(body)).not.toContain("Private other reason");
  });
});
