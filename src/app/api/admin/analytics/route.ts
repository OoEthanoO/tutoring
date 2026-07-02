import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { isExecutive, isFounder, resolveUserRole } from "@/lib/roles";
import { computeCoreTotals, loadCoreRows, parseHours } from "@/lib/impactStats";

const TORONTO_TZ = "America/Toronto";

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
    // Round accumulated floats (e.g. summed duration_hours) to avoid values like
    // 6.7200000000000001 surfacing in tooltips.
    const rounded = Object.fromEntries(
      Object.entries(bucket).map(([key, value]) => [key, Math.round(value * 100) / 100])
    );
    series.push({ week, label: weekLabel(week), ...rounded });
  }
  return series;
}

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
    const rows = await loadCoreRows(adminClient);
    const { users, courses, enrollments, attendance, donations } = rows;

    // Shared with the public impact page so the numbers never drift.
    const { totals, pastClasses } = computeCoreTotals(rows);

    const courseById = new Map(courses.map((course) => [course.id, course]));

    // --- Signups chart rows (verified users, split by resolved role) ---
    const userSignupRows = users.map((row) => {
      const isExec = isExecutive(resolveUserRole(row.email, row.role ?? null));
      return {
        timestamp: row.created_at,
        counters: { students: isExec ? 0 : 1, executives: isExec ? 1 : 0 },
      };
    });

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
        ...totals,
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
