import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { isExecutive, isFounder, resolveUserRole } from "@/lib/roles";

const TORONTO_TZ = "America/Toronto";
const PAGE_SIZE = 1000;

// Supabase caps responses at max_rows (default 1000) regardless of .limit().
// buildQuery must construct a FRESH query each call and include a stable
// .order() so pages don't shuffle between requests.
async function fetchAllRows<T>(
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

// Toronto calendar day of a timestamp, as "YYYY-MM-DD" (en-CA formats ISO-like).
const torontoDayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

// Monday of the ISO week containing a calendar date. Weekday of a calendar date
// is timezone-invariant, so a UTC anchor keeps this DST-safe.
const weekKeyOf = (dayKey: string) => {
  const [y, m, d] = dayKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  return anchor.toISOString().slice(0, 10);
};

const weekLabel = (weekKey: string) =>
  new Date(`${weekKey}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const addWeek = (weekKey: string) => {
  const anchor = new Date(`${weekKey}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + 7);
  return anchor.toISOString().slice(0, 10);
};

// Buckets timestamps into ISO weeks and zero-fills gaps from the series' own
// earliest week to the current Toronto week.
function buildWeeklySeries(
  rows: { timestamp: string; counters: Record<string, number> }[],
  counterKeys: string[]
): Array<{ week: string; label: string } & Record<string, string | number>> {
  if (rows.length === 0) {
    return [];
  }

  const byWeek = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const week = weekKeyOf(torontoDayKey(row.timestamp));
    const bucket = byWeek.get(week) ?? Object.fromEntries(counterKeys.map((k) => [k, 0]));
    for (const key of counterKeys) {
      bucket[key] += row.counters[key] ?? 0;
    }
    byWeek.set(week, bucket);
  }

  const weeks = Array.from(byWeek.keys()).sort();
  const firstWeek = weeks[0];
  const currentWeek = weekKeyOf(torontoDayKey(new Date().toISOString()));

  const series: Array<{ week: string; label: string } & Record<string, string | number>> = [];
  for (let week = firstWeek; week <= currentWeek; week = addWeek(week)) {
    const bucket = byWeek.get(week) ?? Object.fromEntries(counterKeys.map((k) => [k, 0]));
    series.push({ week, label: weekLabel(week), ...bucket });
  }
  return series;
}

const parseHours = (value: number | string | null) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  // 1.5 hours per class is the org convention (matches the withdrawal invariant).
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.5;
};

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles
        .map((r: { role_level?: string }) => r.role_level)
        .filter((level): level is string => Boolean(level))
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isFounder(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const adminClient = getAdminClient();

    const [users, courses, classes, enrollments, attendance, withdrawals, donations] =
      await Promise.all([
        fetchAllRows<{ id: string; email: string | null; role: string | null; created_at: string }>(
          (from, to) =>
            adminClient
              .from("app_users")
              .select("id, email, role, created_at")
              .not("email_verified_at", "is", null)
              .order("created_at", { ascending: true })
              .range(from, to)
        ),
        fetchAllRows<{
          id: string;
          title: string | null;
          created_at: string;
          is_completed: boolean | null;
          created_by: string | null;
        }>((from, to) =>
          adminClient
            .from("courses")
            .select("id, title, created_at, is_completed, created_by")
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<{
          id: string;
          course_id: string;
          starts_at: string;
          duration_hours: number | string | null;
        }>((from, to) =>
          adminClient
            .from("course_classes")
            .select("id, course_id, starts_at, duration_hours")
            .order("starts_at", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<{ course_id: string; student_id: string | null; created_at: string }>(
          (from, to) =>
            adminClient
              .from("course_enrollments")
              .select("course_id, student_id, created_at")
              .order("created_at", { ascending: true })
              .range(from, to)
        ),
        fetchAllRows<{
          class_id: string;
          course_id: string;
          user_id: string;
          is_tutor: boolean | null;
        }>((from, to) =>
          adminClient
            .from("class_attendance")
            .select("class_id, course_id, user_id, is_tutor")
            .order("created_at", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<{ hours: number | string; created_at: string }>((from, to) =>
          adminClient
            .from("tutor_withdrawals")
            .select("hours, created_at")
            .order("created_at", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<{ date: string; amount: number }>((from, to) =>
          adminClient
            .from("daily_donations")
            .select("date, amount")
            .order("date", { ascending: true })
            .range(from, to)
        ),
      ]);

    const nowMs = Date.now();
    const courseById = new Map(courses.map((course) => [course.id, course]));

    // --- Users ---
    let studentCount = 0;
    let executiveCount = 0;
    const userSignupRows = users.map((row) => {
      const resolved = resolveUserRole(row.email, row.role ?? null);
      const isExec = isExecutive(resolved);
      if (isExec) {
        executiveCount += 1;
      } else {
        studentCount += 1;
      }
      return {
        timestamp: row.created_at,
        counters: { students: isExec ? 0 : 1, executives: isExec ? 1 : 0 },
      };
    });

    // --- Courses ---
    const completedCourses = courses.filter((course) => course.is_completed).length;

    // --- Teaching (past classes) ---
    const pastClasses = classes.filter(
      (cls) => new Date(cls.starts_at).getTime() <= nowMs && courseById.has(cls.course_id)
    );
    const hoursTaught = pastClasses.reduce((sum, cls) => sum + parseHours(cls.duration_hours), 0);
    const hoursWithdrawn = withdrawals.reduce((sum, row) => {
      const parsed = Number(row.hours);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);

    // --- Attendance ---
    // Eligible classes = past classes with at least one attendance row: this is
    // both the voice-system-era boundary and the same tracking-failure guard the
    // absence-email cron uses, so outages don't fake absences.
    const attendanceByClass = new Map<string, Set<string>>();
    const classesWithRows = new Set<string>();
    for (const row of attendance) {
      classesWithRows.add(row.class_id);
      if (!row.is_tutor) {
        const set = attendanceByClass.get(row.class_id) ?? new Set<string>();
        set.add(row.user_id);
        attendanceByClass.set(row.class_id, set);
      }
    }

    const enrolledByCourse = new Map<string, Set<string>>();
    for (const row of enrollments) {
      if (!row.student_id) {
        continue;
      }
      const set = enrolledByCourse.get(row.course_id) ?? new Set<string>();
      set.add(row.student_id);
      enrolledByCourse.set(row.course_id, set);
    }

    let attendedSlots = 0;
    let enrolledSlots = 0;
    let trackedClasses = 0;
    const perCourse = new Map<
      string,
      { attended: number; enrolled: number; trackedClasses: number }
    >();

    for (const cls of pastClasses) {
      if (!classesWithRows.has(cls.id)) {
        continue;
      }
      const course = courseById.get(cls.course_id);
      const enrolled = new Set(enrolledByCourse.get(cls.course_id) ?? []);
      if (course?.created_by) {
        enrolled.delete(course.created_by);
      }
      if (enrolled.size === 0) {
        continue;
      }
      const attendedSet = attendanceByClass.get(cls.id) ?? new Set<string>();
      let attendedHere = 0;
      for (const userId of attendedSet) {
        if (enrolled.has(userId)) {
          attendedHere += 1;
        }
      }

      trackedClasses += 1;
      attendedSlots += attendedHere;
      enrolledSlots += enrolled.size;

      const courseStats =
        perCourse.get(cls.course_id) ?? { attended: 0, enrolled: 0, trackedClasses: 0 };
      courseStats.attended += attendedHere;
      courseStats.enrolled += enrolled.size;
      courseStats.trackedClasses += 1;
      perCourse.set(cls.course_id, courseStats);
    }

    const attendanceByCourse = Array.from(perCourse.entries())
      .map(([courseId, stats]) => ({
        courseId,
        title: (courseById.get(courseId)?.title ?? "").trim() || "Untitled course",
        rate: stats.enrolled > 0 ? stats.attended / stats.enrolled : 0,
        attendedSlots: stats.attended,
        enrolledSlots: stats.enrolled,
        trackedClasses: stats.trackedClasses,
      }))
      .sort((a, b) => b.trackedClasses - a.trackedClasses)
      .slice(0, 8);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
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
          classesTaught: pastClasses.length,
        },
        raised: donations.length > 0 ? donations[donations.length - 1].amount : null,
        attendance: {
          rate: enrolledSlots > 0 ? attendedSlots / enrolledSlots : null,
          attendedSlots,
          enrolledSlots,
          trackedClasses,
        },
      },
      charts: {
        signupsPerWeek: buildWeeklySeries(userSignupRows, ["students", "executives"]),
        enrollmentsPerWeek: buildWeeklySeries(
          enrollments.map((row) => ({ timestamp: row.created_at, counters: { enrollments: 1 } })),
          ["enrollments"]
        ),
        teachingPerWeek: buildWeeklySeries(
          pastClasses.map((cls) => ({
            timestamp: cls.starts_at,
            counters: { classes: 1, hours: parseHours(cls.duration_hours) },
          })),
          ["classes", "hours"]
        ),
        donationsOverTime: donations,
        attendanceByCourse,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load analytics." },
      { status: 500 }
    );
  }
}
