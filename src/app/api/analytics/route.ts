import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { isExecutive, isFounder, resolveUserRole } from "@/lib/roles";
import { courseUsesDiscordVoiceSystem } from "@/lib/discordLiveChannels";
import { computeCoreTotals, loadCoreRows, parseHours } from "@/lib/impactStats";
import { classEndMs } from "@/lib/classTiming";

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

// Public endpoint, like /api/impact: open to signed-out visitors, and aggregate,
// non-personal numbers only — no names, emails or per-student rows ever leave
// this handler.
export async function GET() {
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
    const nowMs = Date.now();
    const perCourse = new Map<
      string,
      { attended: number; enrolled: number; trackedClasses: number }
    >();

    for (const cls of pastClasses) {
      if (!classesWithRows.has(cls.id)) {
        continue;
      }
      // pastClasses means "has started", which includes a lesson happening right
      // now: its attendance is whoever has arrived so far, so counting it would
      // dent the course's rate mid-lesson and quietly recover afterwards.
      const classStartMs = new Date(cls.starts_at).getTime();
      if (
        !Number.isFinite(classStartMs) ||
        classEndMs(classStartMs, cls.duration_hours) > nowMs
      ) {
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
      // Every course with tracked attendance is listed. Truncating to a top N
      // hid ongoing courses, which are the ones worth acting on.
      .sort(
        (a, b) => b.trackedClasses - a.trackedClasses || a.title.localeCompare(b.title)
      );

    // Running courses that contribute nothing to the chart above, because none
    // of their finished classes produced an attendance row. Without this, a
    // Discord sync outage looks exactly like a course that does not exist —
    // the rate silently describes a smaller org than the real one.
    const courseHasLiveClass = new Set<string>();
    const pastClassesByCourse = new Map<string, number>();
    const trackedPastClassesByCourse = new Map<string, number>();
    const firstClassMsByCourse = new Map<string, number>();
    for (const cls of rows.classes) {
      const startMs = new Date(cls.starts_at).getTime();
      if (!Number.isFinite(startMs) || !courseById.has(cls.course_id)) {
        continue;
      }
      const knownFirst = firstClassMsByCourse.get(cls.course_id);
      if (knownFirst === undefined || startMs < knownFirst) {
        firstClassMsByCourse.set(cls.course_id, startMs);
      }
      if (classEndMs(startMs, cls.duration_hours) > nowMs) {
        courseHasLiveClass.add(cls.course_id);
        continue;
      }
      pastClassesByCourse.set(
        cls.course_id,
        (pastClassesByCourse.get(cls.course_id) ?? 0) + 1
      );
      if (classesWithRows.has(cls.id)) {
        trackedPastClassesByCourse.set(
          cls.course_id,
          (trackedPastClassesByCourse.get(cls.course_id) ?? 0) + 1
        );
      }
    }

    // Founder-taught courses run on Schoolhouse and pre-cutoff courses on the
    // legacy Zoom flow: neither produces attendance, so listing them as gaps
    // would be crying wolf.
    const founderUserIds = new Set(
      rows.users
        .filter((row) => isFounder(resolveUserRole(row.email, row.role ?? null)))
        .map((row) => row.id)
    );

    const untrackedCourses = Array.from(courseHasLiveClass)
      .filter((courseId) => {
        const course = courseById.get(courseId);
        if (!course || course.is_completed) {
          return false;
        }
        if (course.created_by && founderUserIds.has(course.created_by)) {
          return false;
        }
        const firstClassMs = firstClassMsByCourse.get(courseId);
        if (
          !courseUsesDiscordVoiceSystem(
            firstClassMs === undefined ? null : new Date(firstClassMs)
          )
        ) {
          return false;
        }
        return (
          (pastClassesByCourse.get(courseId) ?? 0) > 0 &&
          (trackedPastClassesByCourse.get(courseId) ?? 0) === 0
        );
      })
      .map((courseId) => ({
        courseId,
        title: (courseById.get(courseId)?.title ?? "").trim() || "Untitled course",
        pastClasses: pastClassesByCourse.get(courseId) ?? 0,
      }))
      .sort((a, b) => b.pastClasses - a.pastClasses || a.title.localeCompare(b.title));

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
        untrackedCourses,
      },
    },
    {
      // Anyone can hit this and it scans several tables, so let the CDN absorb
      // repeat traffic. These numbers move slowly; minutes of staleness is fine.
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load analytics." },
      { status: 500 }
    );
  }
}
