import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";
const torontoTimeZone = "America/Toronto";
const scheduleDriftToleranceMinutes = 5;

type ReminderType = "one_hour" | "twenty_four_hours";

type ReminderTarget = {
  type: ReminderType;
  minutesBeforeStart: number;
  label: string;
};

const reminderTargets: ReminderTarget[] = [
  {
    type: "twenty_four_hours",
    minutesBeforeStart: 24 * 60,
    label: "24 hours",
  },
  {
    type: "one_hour",
    minutesBeforeStart: 60,
    label: "1 hour",
  },
];

type CourseRow = {
  id: string;
  title: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
};

type ClassRow = {
  id: string;
  title: string;
  starts_at: string;
  course_id: string;
  course: CourseRow | CourseRow[] | null;
};

type CandidateReminder = {
  reminderType: ReminderType;
  reminderLabel: string;
  classRow: ClassRow;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const readCourse = (value: ClassRow["course"]): CourseRow | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const floorToFiveMinuteBoundary = (value: Date) => {
  const rounded = new Date(value.getTime());
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % 5;
  if (remainder !== 0) {
    rounded.setMinutes(rounded.getMinutes() - remainder);
  }
  return rounded;
};

const formatTorontoDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: torontoTimeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const sendEmail = async (to: string, subject: string, html: string) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || `Failed to send email (${response.status}).`);
  }
};

export async function POST(request: NextRequest) {
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Missing CRON_SECRET." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  const providedSecret = bearerToken || headerSecret;

  if (!providedSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase server configuration." },
      { status: 500 }
    );
  }

  if (!resendApiKey || !resendFrom) {
    return NextResponse.json(
      { error: "Missing RESEND_API_KEY or RESEND_FROM." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const base = floorToFiveMinuteBoundary(new Date());
  const candidates: CandidateReminder[] = [];

  for (const target of reminderTargets) {
    const targetTime = new Date(
      base.getTime() + target.minutesBeforeStart * 60 * 1000
    );
    // GitHub cron can drift a few minutes. We include a small catch-up window
    // and rely on dedupe logs to prevent duplicate sends.
    const windowStart = new Date(
      targetTime.getTime() - scheduleDriftToleranceMinutes * 60 * 1000
    );
    const windowEnd = new Date(targetTime.getTime() + 5 * 60 * 1000);

    const { data: classes, error: classError } = await adminClient
      .from("course_classes")
      .select(
        "id, title, starts_at, course_id, course:courses(id, title, created_by, created_by_name, created_by_email)"
      )
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString());

    if (classError) {
      return NextResponse.json(
        { error: classError.message ?? "Failed to load classes." },
        { status: 500 }
      );
    }

    for (const classRow of (classes ?? []) as ClassRow[]) {
      candidates.push({
        reminderType: target.type,
        reminderLabel: target.label,
        classRow,
      });
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      sentClassCount: 0,
      sentEmailCount: 0,
      failedClasses: [],
    });
  }

  const courseIds = Array.from(
    new Set(candidates.map((item) => item.classRow.course_id))
  );
  const { data: enrollments, error: enrollmentError } = await adminClient
    .from("course_enrollments")
    .select("course_id, student_email")
    .in("course_id", courseIds);

  if (enrollmentError) {
    return NextResponse.json(
      { error: enrollmentError.message ?? "Failed to load enrollments." },
      { status: 500 }
    );
  }

  const enrollmentsByCourseId = new Map<string, string[]>();
  for (const enrollment of enrollments ?? []) {
    const courseId = enrollment.course_id as string;
    const email = String(enrollment.student_email ?? "").trim();
    if (!email) {
      continue;
    }
    const current = enrollmentsByCourseId.get(courseId) ?? [];
    current.push(email);
    enrollmentsByCourseId.set(courseId, current);
  }

  const missingTutorIds = Array.from(
    new Set(
      candidates
        .map((item) => readCourse(item.classRow.course))
        .filter(Boolean)
        .filter((course) => !course?.created_by_email && course?.created_by)
        .map((course) => course!.created_by as string)
    )
  );

  const tutorEmailById = new Map<string, string>();
  if (missingTutorIds.length > 0) {
    const { data: tutorRows } = await adminClient
      .from("app_users")
      .select("id, email")
      .in("id", missingTutorIds);
    for (const tutor of tutorRows ?? []) {
      const email = String(tutor.email ?? "").trim();
      if (email) {
        tutorEmailById.set(tutor.id as string, email);
      }
    }
  }

  let sentClassCount = 0;
  let sentEmailCount = 0;
  const failedClasses: { classId: string; reason: string }[] = [];

  for (const candidate of candidates) {
    const { classRow, reminderType, reminderLabel } = candidate;
    const course = readCourse(classRow.course);
    if (!course) {
      continue;
    }

    const { data: logRow, error: logError } = await adminClient
      .from("class_reminder_logs")
      .insert({
        class_id: classRow.id,
        reminder_type: reminderType,
      })
      .select("id")
      .single();

    if (logError) {
      if (logError.code === "23505") {
        continue;
      }
      failedClasses.push({
        classId: classRow.id,
        reason: logError.message ?? "Failed to register reminder log.",
      });
      continue;
    }

    const recipients = new Set<string>(
      enrollmentsByCourseId.get(classRow.course_id) ?? []
    );
    const tutorEmail =
      String(course.created_by_email ?? "").trim() ||
      (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
    if (tutorEmail) {
      recipients.add(tutorEmail);
    }

    if (recipients.size === 0) {
      continue;
    }

    const classTitle = escapeHtml(classRow.title);
    const courseTitle = escapeHtml(course.title);
    const tutorName = escapeHtml(
      String(course.created_by_name ?? "Your tutor").trim() || "Your tutor"
    );
    const startLabel = escapeHtml(formatTorontoDateTime(classRow.starts_at));
    const subject = `Class reminder: starts in ${reminderLabel} (${course.title})`;
    const html = `
      <p>Your class starts in <strong>${escapeHtml(reminderLabel)}</strong>.</p>
      <p><strong>Course:</strong> ${courseTitle}</p>
      <p><strong>Class:</strong> ${classTitle}</p>
      <p><strong>Tutor:</strong> ${tutorName}</p>
      <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
    `;

    try {
      await Promise.all(
        Array.from(recipients).map((recipient) =>
          sendEmail(recipient, subject, html)
        )
      );
      sentClassCount += 1;
      sentEmailCount += recipients.size;
    } catch (error) {
      failedClasses.push({
        classId: classRow.id,
        reason: error instanceof Error ? error.message : "Failed to send emails.",
      });
      await adminClient.from("class_reminder_logs").delete().eq("id", logRow.id);
    }
  }

  return NextResponse.json({
    sentClassCount,
    sentEmailCount,
    failedClasses,
    timezone: torontoTimeZone,
  });
}
