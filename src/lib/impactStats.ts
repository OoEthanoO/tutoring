import type { SupabaseClient } from "@supabase/supabase-js";
import { isExecutive, resolveUserRole } from "@/lib/roles";
import { classEndMs } from "@/lib/classTiming";

// Enrollments in courses run before the website existed.
export const LEGACY_ENROLLMENT_COUNT = 272;

const PAGE_SIZE = 1000;

// Supabase caps responses at max_rows (default 1000) regardless of .limit().
// buildQuery must construct a FRESH query each call and include a stable
// .order() so pages don't shuffle between requests.
export async function fetchAllRows<T>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return rows;
    }
  }
}

export const parseHours = (value: number | string | null) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  // Fallback of 1 hour mirrors the tutor-profile taughtMinutes accounting, so
  // these totals reconcile with the per-tutor "minutes taught" numbers.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export type UserRow = {
  id: string;
  email: string | null;
  role: string | null;
  created_at: string;
};
export type CourseRow = {
  id: string;
  title: string | null;
  created_at: string;
  is_completed: boolean | null;
  completed_class_count: number | string | null;
  created_by: string | null;
};
export type ClassRow = {
  id: string;
  course_id: string;
  starts_at: string;
  duration_hours: number | string | null;
};
export type EnrollmentRow = {
  course_id: string;
  student_id: string | null;
  created_at: string;
};
export type AttendanceRow = {
  class_id: string;
  course_id: string;
  user_id: string;
  is_tutor: boolean | null;
};
export type WithdrawalRow = { hours: number | string; created_at: string };
export type DonationRow = { date: string; amount: number };

export type CoreRows = {
  users: UserRow[];
  courses: CourseRow[];
  classes: ClassRow[];
  enrollments: EnrollmentRow[];
  attendance: AttendanceRow[];
  withdrawals: WithdrawalRow[];
  donations: DonationRow[];
};

export async function loadCoreRows(adminClient: SupabaseClient): Promise<CoreRows> {
  const [users, courses, classes, enrollments, attendance, withdrawals, donations] =
    await Promise.all([
      fetchAllRows<UserRow>((from, to) =>
        adminClient
          .from("app_users")
          .select("id, email, role, created_at")
          .not("email_verified_at", "is", null)
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<CourseRow>((from, to) =>
        adminClient
          .from("courses")
          .select("id, title, created_at, is_completed, completed_class_count, created_by")
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<ClassRow>((from, to) =>
        adminClient
          .from("course_classes")
          .select("id, course_id, starts_at, duration_hours")
          .order("starts_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<EnrollmentRow>((from, to) =>
        adminClient
          .from("course_enrollments")
          .select("course_id, student_id, created_at")
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<AttendanceRow>((from, to) =>
        adminClient
          .from("class_attendance")
          .select("class_id, course_id, user_id, is_tutor")
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<WithdrawalRow>((from, to) =>
        adminClient
          .from("tutor_withdrawals")
          .select("hours, created_at")
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<DonationRow>((from, to) =>
        adminClient
          .from("daily_donations")
          .select("date, amount")
          .order("date", { ascending: true })
          .range(from, to)
      ),
    ]);

  return { users, courses, classes, enrollments, attendance, withdrawals, donations };
}

export type CoreTotals = {
  verifiedUsers: { total: number; students: number; executives: number };
  courses: { active: number; completed: number; total: number };
  hours: { taught: number; withdrawn: number; classesTaught: number };
  enrollments: { total: number; platform: number; legacy: number };
  raised: number | null;
};

// The single source of truth for org-wide totals: used by both the founder
// analytics dashboard and the public impact page so the numbers never drift.
export function computeCoreTotals(rows: CoreRows): {
  totals: CoreTotals;
  pastClasses: ClassRow[];
} {
  const { users, courses, classes, enrollments, withdrawals, donations } = rows;
  const nowMs = Date.now();
  const courseById = new Map(courses.map((course) => [course.id, course]));

  // --- Users ---
  let studentCount = 0;
  let executiveCount = 0;
  for (const row of users) {
    if (isExecutive(resolveUserRole(row.email, row.role ?? null))) {
      executiveCount += 1;
    } else {
      studentCount += 1;
    }
  }

  // --- Courses ---
  // Completed matches the Courses tab: either explicitly flagged (legacy archived
  // courses) or a course whose scheduled classes have all ended.
  const classCountByCourse = new Map<string, number>();
  const upcomingByCourse = new Set<string>();
  for (const cls of classes) {
    const startMs = new Date(cls.starts_at).getTime();
    if (!Number.isFinite(startMs)) {
      continue;
    }
    const endMs = classEndMs(startMs, cls.duration_hours);
    classCountByCourse.set(cls.course_id, (classCountByCourse.get(cls.course_id) ?? 0) + 1);
    if (endMs > nowMs) {
      upcomingByCourse.add(cls.course_id);
    }
  }
  const completedCourses = courses.filter(
    (course) =>
      course.is_completed ||
      ((classCountByCourse.get(course.id) ?? 0) > 0 && !upcomingByCourse.has(course.id))
  ).length;

  // --- Teaching (legacy completed courses + past classes) ---
  // Mirrors the tutor-profile taughtMinutes accounting: each legacy completed
  // class counts as 1 hour (completed_class_count × 60 min); modern classes use
  // their scheduled duration.
  const legacyClasses = courses.reduce((sum, course) => {
    if (!course.is_completed) {
      return sum;
    }
    const count = Number(course.completed_class_count ?? 0);
    return sum + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);
  const pastClasses = classes.filter(
    (cls) => new Date(cls.starts_at).getTime() <= nowMs && courseById.has(cls.course_id)
  );
  const hoursTaught =
    legacyClasses + pastClasses.reduce((sum, cls) => sum + parseHours(cls.duration_hours), 0);
  const hoursWithdrawn = withdrawals.reduce((sum, row) => {
    const parsed = Number(row.hours);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  // --- Enrollments (course sizes summed; a student in two courses counts twice) ---
  const platformEnrollments = enrollments.filter((row) => courseById.has(row.course_id)).length;

  return {
    totals: {
      verifiedUsers: {
        total: users.length,
        students: studentCount,
        executives: executiveCount,
      },
      courses: {
        active: courses.length - completedCourses,
        completed: completedCourses,
        total: courses.length,
      },
      hours: {
        taught: Math.round(hoursTaught * 10) / 10,
        withdrawn: Math.round(hoursWithdrawn * 10) / 10,
        classesTaught: legacyClasses + pastClasses.length,
      },
      enrollments: {
        total: platformEnrollments + LEGACY_ENROLLMENT_COUNT,
        platform: platformEnrollments,
        legacy: LEGACY_ENROLLMENT_COUNT,
      },
      raised: donations.length > 0 ? donations[donations.length - 1].amount : null,
    },
    pastClasses,
  };
}
