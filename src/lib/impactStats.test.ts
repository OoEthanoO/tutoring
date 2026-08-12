import { describe, expect, it } from "vitest";
import {
  computeCoreTotals,
  LEGACY_ENROLLMENT_COUNT,
  parseHours,
  type CoreRows,
} from "./impactStats";

// These totals are the org's public numbers: they feed the impact page, the
// analytics dashboard and anything quoted in a grant report. The point of these
// tests is that a refactor cannot quietly change what "hours taught" or
// "courses completed" mean.

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();

const emptyRows: CoreRows = {
  users: [],
  courses: [],
  classes: [],
  enrollments: [],
  attendance: [],
  withdrawals: [],
  donations: [],
};

const rowsWith = (overrides: Partial<CoreRows>): CoreRows => ({ ...emptyRows, ...overrides });

const course = (id: string, overrides: Partial<CoreRows["courses"][number]> = {}) => ({
  id,
  title: `Course ${id}`,
  created_at: iso(-30 * 24 * HOUR),
  is_completed: null,
  completed_class_count: null,
  created_by: "tutor-1",
  ...overrides,
});

const cls = (
  id: string,
  courseId: string,
  startsFromNowMs: number,
  durationHours: number | string = 1
) => ({ id, course_id: courseId, starts_at: iso(startsFromNowMs), duration_hours: durationHours });

describe("computeCoreTotals — users", () => {
  it("splits verified users into executives and students by resolved role", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        users: [
          { id: "u1", email: "a@example.com", role: "student", created_at: iso(-HOUR) },
          { id: "u2", email: "b@example.com", role: "tutor", created_at: iso(-HOUR) },
          { id: "u3", email: "c@example.com", role: "Junior Executive", created_at: iso(-HOUR) },
          { id: "u4", email: "d@example.com", role: null, created_at: iso(-HOUR) },
        ],
      })
    );
    // "tutor" normalizes to an executive tier; an unset role falls back to student.
    expect(totals.verifiedUsers).toEqual({ total: 4, students: 2, executives: 2 });
  });

  it("counts a hardcoded founder email as an executive whatever the role column says", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        users: [
          { id: "u1", email: "ethanxucoder@gmail.com", role: "student", created_at: iso(-HOUR) },
        ],
      })
    );
    expect(totals.verifiedUsers.executives).toBe(1);
  });
});

describe("computeCoreTotals — courses", () => {
  it("counts a course as completed once every class has ended", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("finished"), course("running"), course("future")],
        classes: [
          cls("c1", "finished", -3 * HOUR),
          cls("c2", "finished", -2 * HOUR),
          cls("c3", "running", -2 * HOUR),
          cls("c4", "running", 2 * HOUR),
          cls("c5", "future", 24 * HOUR),
        ],
      })
    );
    expect(totals.courses).toEqual({ active: 2, completed: 1, total: 3 });
  });

  it("treats a class in progress as not yet ended", () => {
    // Started 30 minutes ago, runs an hour: the course is still active.
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("running")],
        classes: [cls("c1", "running", -0.5 * HOUR, 1)],
      })
    );
    expect(totals.courses.completed).toBe(0);
  });

  it("honours the legacy completed flag even with no classes", () => {
    const { totals } = computeCoreTotals(
      rowsWith({ courses: [course("legacy", { is_completed: true })] })
    );
    expect(totals.courses).toEqual({ active: 0, completed: 1, total: 1 });
  });

  it("does not count a course with no classes as completed", () => {
    const { totals } = computeCoreTotals(rowsWith({ courses: [course("empty")] }));
    expect(totals.courses).toEqual({ active: 1, completed: 0, total: 1 });
  });
});

describe("computeCoreTotals — teaching hours", () => {
  it("sums scheduled durations of classes that have started", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("a")],
        classes: [
          cls("c1", "a", -3 * HOUR, 1.5),
          cls("c2", "a", -2 * HOUR, 1),
          cls("c3", "a", 2 * HOUR, 2), // still upcoming, not counted
        ],
      })
    );
    expect(totals.hours.taught).toBe(2.5);
    expect(totals.hours.classesTaught).toBe(2);
  });

  it("adds legacy completed courses at one hour per class", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("legacy", { is_completed: true, completed_class_count: 8 })],
      })
    );
    expect(totals.hours.taught).toBe(8);
    expect(totals.hours.classesTaught).toBe(8);
  });

  it("ignores classes whose course was deleted", () => {
    // loadCoreRows filters deleted courses but not their classes, so an orphan
    // class must not inflate the hours.
    const { totals } = computeCoreTotals(
      rowsWith({ courses: [], classes: [cls("c1", "gone", -2 * HOUR, 2)] })
    );
    expect(totals.hours.taught).toBe(0);
    expect(totals.hours.classesTaught).toBe(0);
  });

  it("rounds accumulated floats to one decimal", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("a")],
        // 1.33 h is what an 80-minute class reads back as from numeric(4,2).
        classes: [cls("c1", "a", -3 * HOUR, 1.33), cls("c2", "a", -2 * HOUR, 1.33)],
      })
    );
    expect(totals.hours.taught).toBe(2.7);
  });

  it("sums withdrawn hours from string or number columns", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        withdrawals: [
          { hours: 4.5, created_at: iso(-HOUR) },
          { hours: "2.25", created_at: iso(-HOUR) },
        ],
      })
    );
    expect(totals.hours.withdrawn).toBe(6.8);
  });
});

describe("computeCoreTotals — enrollments and donations", () => {
  it("counts platform enrollments and adds the pre-website figure", () => {
    const { totals } = computeCoreTotals(
      rowsWith({
        courses: [course("a")],
        enrollments: [
          { course_id: "a", student_id: "s1", created_at: iso(-HOUR) },
          { course_id: "a", student_id: "s2", created_at: iso(-HOUR) },
          // Enrollment in a deleted course is not a platform enrollment.
          { course_id: "gone", student_id: "s3", created_at: iso(-HOUR) },
        ],
      })
    );
    expect(totals.enrollments.platform).toBe(2);
    expect(totals.enrollments.legacy).toBe(LEGACY_ENROLLMENT_COUNT);
    expect(totals.enrollments.total).toBe(2 + LEGACY_ENROLLMENT_COUNT);
  });

  it("reports the latest cumulative donation total, or null with no data", () => {
    expect(
      computeCoreTotals(
        rowsWith({
          donations: [
            { date: "2026-08-01", amount: 100 },
            { date: "2026-08-09", amount: 250 },
          ],
        })
      ).totals.raised
    ).toBe(250);
    expect(computeCoreTotals(emptyRows).totals.raised).toBeNull();
  });
});

describe("computeCoreTotals — pastClasses", () => {
  it("returns the started classes of live courses, for the attendance pass", () => {
    const { pastClasses } = computeCoreTotals(
      rowsWith({
        courses: [course("a")],
        classes: [
          cls("c1", "a", -2 * HOUR),
          cls("c2", "a", 2 * HOUR),
          cls("c3", "gone", -2 * HOUR),
        ],
      })
    );
    expect(pastClasses.map((row) => row.id)).toEqual(["c1"]);
  });
});

describe("parseHours", () => {
  it("parses numbers and strings, and falls back to one hour", () => {
    expect(parseHours(1.5)).toBe(1.5);
    expect(parseHours("2.25")).toBe(2.25);
    expect(parseHours(null)).toBe(1);
    expect(parseHours(0)).toBe(1);
    expect(parseHours(-3)).toBe(1);
  });
});
