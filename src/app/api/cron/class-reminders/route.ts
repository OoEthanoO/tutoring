import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runDiscordSync, type DiscordSyncResult } from "@/lib/discordSync";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";
const torontoTimeZone = "America/Toronto";
const defaultZoomId = "822 9677 5321";
const defaultZoomPassword = "youth";
type ReminderType = "one_hour" | "twenty_four_hours" | "class_follow_up";

type ReminderTarget = {
  type: ReminderType;
  minutesBeforeStart: number;
  label: string;
  lowerBoundDriftMinutes: number;
};

const reminderTargets: ReminderTarget[] = [
  {
    type: "twenty_four_hours",
    minutesBeforeStart: 24 * 60,
    label: "24 hours",
    lowerBoundDriftMinutes: 5,
  },
  {
    type: "one_hour",
    minutesBeforeStart: 60,
    label: "1 hour",
    lowerBoundDriftMinutes: 0,
  },
];

type CourseRow = {
  id: string;
  title: string;
  short_name?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
};

type ClassRow = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number | string;
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const sendEmail = async (to: string, subject: string, html: string) => {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

    if (response.ok) {
      return;
    }

    const details = await response.text().catch(() => "");
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseFloat(retryAfterHeader)
      : Number.NaN;
    const isRetriable = response.status === 429 || response.status >= 500;

    if (!isRetriable || attempt === maxAttempts) {
      throw new Error(details || `Failed to send email (${response.status}).`);
    }

    const backoffMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds * 1000)
        : 500 * 2 ** (attempt - 1);
    await sleep(backoffMs);
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let discordSync: DiscordSyncResult;
  try {
    discordSync = await runDiscordSync({ adminClient });
  } catch (error) {
    discordSync = {
      enabled: true,
      skippedReason: null,
      kickedMemberCount: 0,
      createdCategoryCount: 0,
      createdRoleCount: 0,
      createdCourseRoleCount: 0,
      baseRoleAddedCount: 0,
      baseRoleRemovedCount: 0,
      courseRoleAddedCount: 0,
      courseRoleRemovedCount: 0,
      createdChannelCount: 0,
      updatedChannelCount: 0,
      archivedChannelCount: 0,
      deletedChannelCount: 0,
      deletedCourseRoleCount: 0,
      errors: [
        error instanceof Error
          ? error.message
          : "Unknown Discord sync failure.",
      ],
    };
  }

  if (!resendApiKey || !resendFrom) {
    return NextResponse.json({
      sentClassCount: 0,
      sentEmailCount: 0,
      failedClasses: [],
      timezone: torontoTimeZone,
      reminderSkippedReason: "Missing RESEND_API_KEY or RESEND_FROM.",
      discordSync,
    });
  }

  const base = floorToFiveMinuteBoundary(new Date());
  const candidates: CandidateReminder[] = [];

  for (const target of reminderTargets) {
    const targetTime = new Date(
      base.getTime() + target.minutesBeforeStart * 60 * 1000
    );
    // GitHub cron can drift a few minutes. We include a small catch-up window
    // and rely on dedupe logs to prevent duplicate sends.
    const windowStart = new Date(
      targetTime.getTime() - target.lowerBoundDriftMinutes * 60 * 1000
    );
    const windowEnd = new Date(targetTime.getTime() + 5 * 60 * 1000);

    const { data: classes, error: classError } = await adminClient
      .from("course_classes")
      .select(
        "id, title, starts_at, duration_hours, course_id, course:courses(id, title, short_name, created_by, created_by_name, created_by_email)"
      )
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString());

    if (classError) {
      return NextResponse.json(
        {
          error: classError.message ?? "Failed to load classes.",
          discordSync,
        },
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

  // Follow-ups
  const followUpWindowStart = new Date(base.getTime() - 2 * 60 * 1000);
  const followUpWindowEnd = new Date(base.getTime() + 5 * 60 * 1000);
  const searchStart = new Date(base.getTime() - 24 * 60 * 60 * 1000);

  const { data: pastClasses, error: pastClassError } = await adminClient
    .from("course_classes")
    .select(
      "id, title, starts_at, duration_hours, course_id, course:courses(id, title, short_name, created_by, created_by_name, created_by_email)"
    )
    .gte("starts_at", searchStart.toISOString())
    .lt("starts_at", followUpWindowEnd.toISOString());

  if (pastClassError) {
    return NextResponse.json(
      {
        error: pastClassError.message ?? "Failed to load classes for follow-up.",
        discordSync,
      },
      { status: 500 }
    );
  }

  for (const classRow of (pastClasses ?? []) as ClassRow[]) {
    const startsAt = new Date(classRow.starts_at);
    const durationHours = typeof classRow.duration_hours === 'number'
      ? classRow.duration_hours
      : Number.parseFloat(String(classRow.duration_hours));

    if (Number.isNaN(durationHours)) {
      continue;
    }

    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);

    if (endsAt >= followUpWindowStart && endsAt < followUpWindowEnd) {
      candidates.push({
        reminderType: "class_follow_up",
        reminderLabel: "0 minutes",
        classRow,
      });
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      sentClassCount: 0,
      sentEmailCount: 0,
      failedClasses: [],
      timezone: torontoTimeZone,
      discordSync,
    });
  }

  const courseIds = Array.from(
    new Set(candidates.map((item) => item.classRow.course_id))
  );
  const { data: enrollments, error: enrollmentError } = await adminClient
    .from("course_enrollments")
    .select("course_id, student_id, student_email")
    .in("course_id", courseIds);

  if (enrollmentError) {
    return NextResponse.json(
      {
        error: enrollmentError.message ?? "Failed to load enrollments.",
        discordSync,
      },
      { status: 500 }
    );
  }

  const enrollmentsByCourseId = new Map<string, string[]>();
  const studentIds = new Set<string>();
  for (const enrollment of enrollments ?? []) {
    const courseId = String(enrollment.course_id ?? "").trim();
    if (!courseId) {
      continue;
    }
    const studentId = String(enrollment.student_id ?? "").trim();
    if (studentId) {
      studentIds.add(studentId);
    }
    const email = String(enrollment.student_email ?? "").trim();
    if (!email) {
      continue;
    }
    const current = enrollmentsByCourseId.get(courseId) ?? [];
    current.push(email);
    enrollmentsByCourseId.set(courseId, current);
  }

  if (studentIds.size > 0) {
    const { data: studentRows } = await adminClient
      .from("app_users")
      .select("id, email")
      .in("id", Array.from(studentIds));
    const studentEmailById = new Map<string, string>();
    for (const student of studentRows ?? []) {
      const studentId = String(student.id ?? "").trim();
      const email = String(student.email ?? "").trim();
      if (studentId && email) {
        studentEmailById.set(studentId, email);
      }
    }

    for (const enrollment of enrollments ?? []) {
      const courseId = String(enrollment.course_id ?? "").trim();
      const studentId = String(enrollment.student_id ?? "").trim();
      if (!courseId || !studentId) {
        continue;
      }
      const canonicalEmail = studentEmailById.get(studentId);
      if (!canonicalEmail) {
        continue;
      }
      const current = enrollmentsByCourseId.get(courseId) ?? [];
      current.push(canonicalEmail);
      enrollmentsByCourseId.set(courseId, current);
    }
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

    const { error: logError } = await adminClient
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

    const recipients = new Set<string>();

    if (reminderType !== "class_follow_up") {
      for (const email of enrollmentsByCourseId.get(classRow.course_id) ?? []) {
        recipients.add(email.toLowerCase());
      }
    }

    const tutorEmail =
      String(course.created_by_email ?? "").trim() ||
      (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
    if (tutorEmail) {
      recipients.add(tutorEmail.toLowerCase());
    }

    if (recipients.size === 0) {
      continue;
    }

    const classTitle = escapeHtml(classRow.title);
    const courseTitle = escapeHtml(course.title);
    const tutorNameRaw =
      String(course.created_by_name ?? "").trim() || "your tutor";
    const tutorName = escapeHtml(tutorNameRaw);
    const courseShortName = String(course.short_name ?? "").trim();
    const tutorNameParts = tutorNameRaw.split(/\s+/).filter(Boolean);
    const tutorFirstName = tutorNameParts[0] ?? "Tutor";
    const tutorLastInitial =
      tutorNameParts.length > 1
        ? `${tutorNameParts[tutorNameParts.length - 1][0]}`
        : "";
    const breakoutRoomName =
      courseShortName.length > 0
        ? `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}: ${courseShortName}`
        : "";
    const startLabel = escapeHtml(formatTorontoDateTime(classRow.starts_at));
    let subject = "";
    let html = "";

    if (reminderType === "class_follow_up") {
      subject = `Class follow-up: Please submit the tutor form for ${course.title}`;
      const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfbp8hNm_hpGUfH-SvGbnF7LbsiemBbeXhjddVccSHS8di2nw/viewform";
      html = `
        <p>Hi ${tutorName},</p>
        <p>Your class <strong>${classTitle}</strong> for <strong>${courseTitle}</strong> recently ended.</p>
        <p>Please remember to complete the tutor form:</p>
        <p><a href="${formUrl}"><strong>${formUrl}</strong></a></p>
        <br/>
        <p><strong>Class details:</strong></p>
        <ul>
          <li><strong>Course:</strong> ${courseTitle}</li>
          <li><strong>Class:</strong> ${classTitle}</li>
          <li><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</li>
        </ul>
        <p>Thank you!</p>
      `;
    } else {
      subject = `Class reminder: starts in ${reminderLabel} (${course.title})`;
      html = `
        <p>Your class starts in <strong>${escapeHtml(reminderLabel)}</strong>.</p>
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>Class:</strong> ${classTitle}</p>
        <p><strong>Tutor:</strong> ${tutorName}</p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
        <p>Please attend the class 5 minutes before the start time:</p>
        <p>Zoom ID: ${escapeHtml(defaultZoomId)}<br/>Password: ${escapeHtml(defaultZoomPassword)}<br/>${breakoutRoomName
          ? `Breakout room: "${escapeHtml(breakoutRoomName)}"`
          : `Please join the breakout room that starts with "${escapeHtml(
            `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}`
          )}" followed by the name of the course.`
        }</p>
      `;
    }

    const recipientList = Array.from(recipients).sort();
    const failedRecipients: { email: string; reason: string }[] = [];
    let successfulSends = 0;

    for (const recipient of recipientList) {
      try {
        await sendEmail(recipient, subject, html);
        successfulSends += 1;
        // Pace requests to reduce email provider throttling on bursts.
        await sleep(150);
      } catch (error) {
        failedRecipients.push({
          email: recipient,
          reason:
            error instanceof Error ? error.message : "Failed to send email.",
        });
      }
    }

    if (failedRecipients.length > 0) {
      failedClasses.push({
        classId: classRow.id,
        reason: `Failed recipients: ${failedRecipients
          .map((item) => `${item.email} (${item.reason})`)
          .join("; ")}`,
      });
    }

    if (successfulSends > 0) {
      sentClassCount += 1;
      sentEmailCount += successfulSends;
    }
  }

  return NextResponse.json({
    sentClassCount,
    sentEmailCount,
    failedClasses,
    timezone: torontoTimeZone,
    discordSync,
  });
}
