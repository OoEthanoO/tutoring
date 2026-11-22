import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Management creating a course directly (api/admin/courses), and approving a
 * course request, which writes the course through the same code.
 */

const mocks = vi.hoisted(() => ({ context: vi.fn(), user: vi.fn(), client: vi.fn(), email: vi.fn(), discord: vi.fn() }));
vi.mock("@/lib/authServer", () => ({
  getRequestAuthContext: mocks.context, getRequestUser: mocks.user, getAdminClient: () => mocks.client(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client() }));
vi.mock("@/lib/notificationsServer", () => ({
  sendEmail: mocks.email, sendDiscordMessageByChannelName: mocks.discord, executivesChannelName: () => "executives",
}));

let route: typeof import("./route");
let approve: typeof import("../../course-requests/[requestId]/approve/route");

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failClassInsert: boolean;

const coo = { id: "coo", full_name: "Chief Operating", email: "coo@example.test", role: "COO" };
const tutor = { id: "tutor", full_name: "Tutor One", email: "tutor@example.test", role: "executive", senior_tutor: false, discord_user_id: "111" };
const senior = { id: "senior", full_name: "Senior Tutor", email: "senior@example.test", role: "executive", senior_tutor: true, discord_user_id: null };
const student = { id: "student", full_name: "Student", email: "student@example.test", role: "student" };
const shadow = {
  id: "shadow", full_name: "Shadow", email: "shadow@example.test", role: "student",
  custom_role: "CEO Shadow", custom_roles: { role_level: "executive" },
};

const signInAs = (user: Row | null) => {
  mocks.context.mockResolvedValue({ actor: user, user, isImpersonating: false, impersonatedUserId: null });
  mocks.user.mockResolvedValue(user);
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(new NextRequest("https://example.test/api/admin/courses", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const list = () => route.GET(new NextRequest("https://example.test/api/admin/courses"));
const course = () => tables.courses[0];

beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
  [route, approve] = await Promise.all([import("./route"), import("../../course-requests/[requestId]/approve/route")]);
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email.mockResolvedValue(true);
  mocks.discord.mockResolvedValue(true);
  failClassInsert = false;
  tables = {
    app_users: [{ ...coo }, { ...tutor }, { ...senior }, { ...student }, { ...shadow }],
    tutor_profiles: [{ user_id: "senior", payment_note: "e-Transfer" }],
    courses: [],
    course_classes: [],
    course_creation_requests: [],
  };
  // The parts of the query builder these routes use, over in-memory rows.
  mocks.client.mockReturnValue({ from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let action = "select";
    let payload: Row | Row[] = {};
    let window: [number, number] | null = null;
    let ascending: string | null = null;
    const run = () => {
      if (action === "insert") {
        if (table === "course_classes" && failClassInsert) return { data: null, error: { message: "insert failed" } };
        const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: `${table}-${tables[table].length}`, ...row }));
        rows.forEach((row, index) => { row.id = `${table}-${tables[table].length + index}`; });
        tables[table].push(...rows);
        return { data: rows, error: null };
      }
      let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (action === "update") rows.forEach((row) => Object.assign(row, payload));
      if (ascending) rows = [...rows].sort((a, b) => String(a[ascending!]).localeCompare(String(b[ascending!])));
      if (window) rows = rows.slice(window[0], window[1] + 1);
      if (table === "course_creation_requests") {
        rows = rows.map((row) => ({
          ...row,
          app_users: tables.app_users.find((user) => user.id === row.created_by) ?? null,
          co_tutor: tables.app_users.find((user) => user.id === row.co_tutor_id) ?? null,
        }));
      }
      return { data: rows, error: null };
    };
    const query = {
      select: () => query,
      order: (key: string) => { ascending = key; return query; },
      range: (from: number, to: number) => { window = [from, to]; return query; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      insert: (rows: Row | Row[]) => { action = "insert"; payload = rows; return query; },
      update: (values: Row) => { action = "update"; payload = values; return query; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return query;
  } });
});

describe("listing who can teach", () => {
  it("gives management every executive, custom roles included, but no students", async () => {
    signInAs(coo);
    const response = await list();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentUserId).toBe("coo");
    expect(body.tutors.map((entry: { id: string }) => entry.id).sort()).toEqual(["coo", "senior", "shadow", "tutor"]);
    expect(body.tutors.find((entry: { id: string }) => entry.id === "senior")).toEqual({
      id: "senior", name: "Senior Tutor", seniorTutor: true, hasPaymentNote: true,
    });
    expect(body.tutors.find((entry: { id: string }) => entry.id === "tutor")).toMatchObject({ seniorTutor: false, hasPaymentNote: false });
  });

  it("is closed to tutors and to visitors", async () => {
    signInAs(tutor);
    expect((await list()).status).toBe(403);
    signInAs(null);
    expect((await list()).status).toBe(401);
  });
});

describe("creating a course", () => {
  beforeEach(() => signInAs(coo));

  it("creates the course and its classes for a tutor, and tells the tutor", async () => {
    const response = await post({
      title: "Grade 10 Science", description: "Chemistry and biology", ownerId: "tutor", coTutorId: "senior",
      maxStudents: 12, gradeLevel: 10, donationFee: 20, recordingsEnabled: false,
      classes: [
        { startsAt: "2026-12-08T23:00:00.000Z", durationHours: 1, tutorId: "senior" },
        { startsAt: "2026-12-01T23:00:00.000Z", durationHours: 1.5 },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, courseId: "courses-0", classesAdded: true, announced: true });
    expect(course()).toMatchObject({
      title: "Grade 10 Science", description: "Chemistry and biology", max_students: 12, grade_level: 10,
      donation_fee: 20, is_paid: false, paid_fee: null, recordings_enabled: false, is_completed: false,
      created_by: "tutor", created_by_name: "Tutor One", created_by_email: "tutor@example.test",
      is_co_taught: true, co_tutor_id: "senior", co_tutor_name: "Senior Tutor", co_tutor_email: "senior@example.test",
    });
    expect(tables.course_classes.map(({ title, starts_at, duration_hours, created_by, course_id }) =>
      ({ title, starts_at, duration_hours, created_by, course_id }))).toEqual([
      { title: "Class 1", starts_at: "2026-12-01T23:00:00.000Z", duration_hours: 1.5, created_by: "tutor", course_id: "courses-0" },
      { title: "Class 2", starts_at: "2026-12-08T23:00:00.000Z", duration_hours: 1, created_by: "senior", course_id: "courses-0" },
    ]);
    expect(mocks.email.mock.calls.map(([to]) => to).sort()).toEqual(["senior@example.test", "tutor@example.test"]);
    expect(mocks.discord).toHaveBeenCalledOnce();
    const [channel, content] = mocks.discord.mock.calls[0];
    expect(channel).toBe("executives");
    expect(content).toContain("<@111>");
    expect(content).toContain("**Senior Tutor**");
    expect(content).toContain("Grade 10 Science");
  });

  it("tells nobody when management creates a course it teaches alone", async () => {
    const response = await post({ title: "Founder Course", ownerId: "coo" });
    expect(response.status).toBe(200);
    expect((await response.json()).announced).toBe(true);
    expect(course()).toMatchObject({ created_by: "coo", is_co_taught: false, co_tutor_id: null, recordings_enabled: true });
    expect(mocks.email).not.toHaveBeenCalled();
    expect(mocks.discord).not.toHaveBeenCalled();
  });

  it("lets a custom-role executive teach", async () => {
    expect((await post({ title: "Shadowed", ownerId: "shadow" })).status).toBe(200);
    expect(course().created_by).toBe("shadow");
  });

  it("refuses a student, an unknown account or a student co-tutor as a teacher", async () => {
    for (const body of [
      { title: "Course", ownerId: "student" },
      { title: "Course", ownerId: "nobody" },
      { title: "Course", ownerId: "tutor", coTutorId: "student" },
    ]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("must be an executive");
    }
    expect(tables.courses).toHaveLength(0);
  });

  it("makes a paid course only for senior tutors with a payment note", async () => {
    const refused = await post({ title: "Paid", ownerId: "tutor", isPaid: true, paidFee: 60 });
    expect(refused.status).toBe(400);
    expect(tables.courses).toHaveLength(0);

    const created = await post({ title: "Paid", ownerId: "senior", isPaid: true, paidFee: 60, donationFee: 10 });
    expect(created.status).toBe(200);
    expect(course()).toMatchObject({ is_paid: true, paid_fee: 60, donation_fee: null });
    expect(mocks.email.mock.calls[0][2]).toContain("$60");
  });

  it("refuses a form that does not parse", async () => {
    const response = await post({ title: "", ownerId: "tutor" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("title");
    expect(tables.courses).toHaveLength(0);
  });

  it("keeps the course when its classes cannot be written, and says so", async () => {
    failClassInsert = true;
    const response = await post({
      title: "Course", ownerId: "tutor", classes: [{ startsAt: "2026-12-01T23:00:00.000Z", durationHours: 1 }],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).classesAdded).toBe(false);
    expect(tables.courses).toHaveLength(1);
  });

  it("says when YanBot could not post the announcement", async () => {
    mocks.discord.mockResolvedValue(false);
    expect((await (await post({ title: "Course", ownerId: "tutor" })).json()).announced).toBe(false);
    expect(tables.courses).toHaveLength(1);
  });

  it("is closed to tutors, visitors and other sites", async () => {
    signInAs(tutor);
    expect((await post({ title: "Course", ownerId: "tutor" })).status).toBe(403);
    signInAs(null);
    expect((await post({ title: "Course", ownerId: "tutor" })).status).toBe(401);
    signInAs(coo);
    expect((await post({ title: "Course", ownerId: "tutor" }, { Origin: "https://elsewhere.example" })).status).toBe(403);
    expect(tables.courses).toHaveLength(0);
  });
});

describe("approving a course request", () => {
  it("still creates the course and its classes from the request", async () => {
    signInAs(coo);
    tables.course_creation_requests.push({
      id: "request", title: "Grade 9 Math", description: "Algebra", status: "in_review", created_by: "tutor",
      is_co_taught: false, co_tutor_id: null, recordings_enabled: true, is_paid: false,
    });
    const response = await approve.POST(
      new NextRequest("https://example.test/api/course-requests/request/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxStudents: 8, donationFee: 5, gradeLevel: 9,
          classes: [{ title: "Class 1", startsAt: "2026-12-02T23:00:00.000Z", durationHours: 1 }],
        }),
      }),
      { params: Promise.resolve({ requestId: "request" }) }
    );
    expect(response.status).toBe(200);
    expect(course()).toMatchObject({
      title: "Grade 9 Math", description: "Algebra", max_students: 8, donation_fee: 5, grade_level: 9,
      created_by: "tutor", created_by_name: "Tutor One", is_completed: false, recordings_enabled: true,
    });
    expect(tables.course_classes).toEqual([
      expect.objectContaining({ course_id: "courses-0", title: "Class 1", starts_at: "2026-12-02T23:00:00.000Z", created_by: "tutor" }),
    ]);
    expect(tables.course_creation_requests[0]).toMatchObject({ status: "approved", decided_by: "coo" });
    expect(mocks.email).toHaveBeenCalledWith("tutor@example.test", expect.stringContaining("Grade 9 Math"), expect.any(String));
  });
});
