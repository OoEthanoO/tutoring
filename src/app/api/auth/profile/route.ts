import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getSessionUser } from "@/lib/authServer";
import { isExecutive, resolveUserRole } from "@/lib/roles";

const SESSION_COOKIE = "session";

// Only tutors may opt out of class reminder emails; students always receive them.
const canToggleClassReminderEmails = (user: {
  email?: string | null;
  role?: string | null;
  custom_roles?: { role_level?: string } | { role_level?: string }[] | null;
}) => {
  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter((v): v is string => Boolean(v))
    : [user.custom_roles?.role_level].filter((v): v is string => Boolean(v));
  return isExecutive(resolveUserRole(user.email, user.role ?? null, customRoleLevels));
};

/**
 * Current notification preferences. Served separately from the session payload
 * so a missing column can never break authentication — an unreadable preference
 * simply reports the default (opted in).
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const canToggle = canToggleClassReminderEmails(user);

  const { data, error } = await getAdminClient()
    .from("app_users")
    .select("class_reminder_emails")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    canToggleClassReminderEmails: canToggle,
    // Default to opted in whenever the value is absent or unreadable.
    classReminderEmails: error ? true : data?.class_reminder_emails !== false,
  });
}

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
      fullName?: string;
      discordUsername?: string;
      legalName?: string;
      grade?: string;
      classReminderEmails?: boolean;
    }
    | null;

  if (
    body?.fullName === undefined &&
    body?.discordUsername === undefined &&
    body?.legalName === undefined &&
    body?.grade === undefined &&
    body?.classReminderEmails === undefined
  ) {
    return NextResponse.json(
      { error: "No profile fields provided to update." },
      { status: 400 }
    );
  }

  if (body?.discordUsername !== undefined) {
    return NextResponse.json(
      {
        error:
          "Manual Discord username updates are disabled. Use Connect Discord.",
      },
      { status: 400 }
    );
  }

  const updates: Record<string, string | boolean | null> = {};

  if (body?.classReminderEmails !== undefined) {
    if (typeof body.classReminderEmails !== "boolean") {
      return NextResponse.json(
        { error: "classReminderEmails must be true or false." },
        { status: 400 }
      );
    }
    // Students are always reminded about their classes — only tutors may opt out.
    if (!canToggleClassReminderEmails(user)) {
      return NextResponse.json(
        { error: "Only tutors can change class reminder emails." },
        { status: 403 }
      );
    }
    updates.class_reminder_emails = body.classReminderEmails;
  }

  if (body?.fullName !== undefined) {
    const fullName = body.fullName.trim();
    if (!fullName) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    updates.full_name = fullName;
  }

  if (body?.legalName !== undefined) {
    updates.legal_name = body.legalName.trim() || null;
  }

  if (body?.grade !== undefined) {
    const grade = String(body.grade).trim();
    if (!/^(9|10|11|12)$/.test(grade)) {
      return NextResponse.json(
        { error: "Grade must be 9, 10, 11, or 12." },
        { status: 400 }
      );
    }
    updates.grade = grade;
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("app_users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    const message = error.message ?? "Failed to update profile.";
    // The column is added by a migration; without it the save cannot succeed and
    // the raw Postgres error tells the user nothing useful.
    if (/class_reminder_emails/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Reminder email settings aren't available yet — the database migration has not been applied.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (updates.full_name) {
    await Promise.all([
      adminClient
        .from("courses")
        .update({ created_by_name: updates.full_name })
        .eq("created_by", user.id),
      adminClient
        .from("course_enrollments")
        .update({ student_name: updates.full_name })
        .eq("student_id", user.id),
      adminClient
        .from("course_enrollment_requests")
        .update({ student_name: updates.full_name })
        .eq("student_id", user.id),
    ]);
  }

  return NextResponse.json({ success: true });
}
