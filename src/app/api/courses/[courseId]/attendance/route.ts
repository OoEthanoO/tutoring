import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type RosterEntry = {
  userId: string;
  name: string;
  isTutor: boolean;
  present: boolean;
  firstSeenAt: string | null;
  hasDiscord: boolean;
};

/**
 * Returns each class of a course with an attendance roster (present/absent for
 * enrolled students and the tutor). Authorized for founders/CEOs/COOs or the
 * course's own tutor (creator). Attendance is auto-recorded by the class-reminders
 * cron from Discord voice presence.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { courseId: string } | Promise<{ courseId: string }> }
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const courseId = resolvedParams?.courseId ?? "";
  if (!courseId) {
    return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: course, error: courseError } = await adminClient
    .from("courses")
    .select("id, title, created_by, created_by_name, created_by_email")
    .eq("id", courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  const isOwner = String(course.created_by ?? "") === String(user.id);
  if (!isFounder(role) && !isOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Classes, enrolled students, and recorded attendance for this course.
  const [{ data: classes }, { data: enrollments }, { data: attendance }] = await Promise.all([
    adminClient
      .from("course_classes")
      .select("id, title, starts_at, duration_hours")
      .eq("course_id", courseId)
      .order("starts_at", { ascending: true }),
    adminClient
      .from("course_enrollments")
      .select("student_id")
      .eq("course_id", courseId),
    adminClient
      .from("class_attendance")
      .select("class_id, user_id, is_tutor, first_seen_at")
      .eq("course_id", courseId),
  ]);

  const studentIds = Array.from(
    new Set((enrollments ?? []).map((e) => String(e.student_id ?? "")).filter(Boolean))
  );

  // Resolve display names + Discord-linked status for students and the tutor.
  const lookupIds = Array.from(new Set([...studentIds, String(course.created_by ?? "")].filter(Boolean)));
  const usersById = new Map<string, { name: string; hasDiscord: boolean }>();
  if (lookupIds.length > 0) {
    const { data: userRows } = await adminClient
      .from("app_users")
      .select("id, full_name, email, discord_user_id")
      .in("id", lookupIds);
    for (const row of userRows ?? []) {
      usersById.set(String(row.id), {
        name: (row.full_name ?? "").trim() || (row.email ?? "").trim() || "Unknown",
        hasDiscord: Boolean(String(row.discord_user_id ?? "").trim()),
      });
    }
  }

  // attendance: class_id -> user_id -> firstSeenAt
  const attendanceByClass = new Map<string, Map<string, string | null>>();
  for (const row of attendance ?? []) {
    const classId = String(row.class_id);
    const byUser = attendanceByClass.get(classId) ?? new Map<string, string | null>();
    byUser.set(String(row.user_id), (row.first_seen_at as string | null) ?? null);
    attendanceByClass.set(classId, byUser);
  }

  const tutorId = String(course.created_by ?? "");
  const tutorName =
    (course.created_by_name ?? "").trim() ||
    usersById.get(tutorId)?.name ||
    (course.created_by_email ?? "").trim() ||
    "Tutor";

  const roster = (classId: string): RosterEntry[] => {
    const byUser = attendanceByClass.get(classId) ?? new Map<string, string | null>();
    const entries: RosterEntry[] = [];

    if (tutorId) {
      entries.push({
        userId: tutorId,
        name: tutorName,
        isTutor: true,
        present: byUser.has(tutorId),
        firstSeenAt: byUser.get(tutorId) ?? null,
        hasDiscord: usersById.get(tutorId)?.hasDiscord ?? false,
      });
    }
    for (const studentId of studentIds) {
      if (studentId === tutorId) {
        continue;
      }
      const info = usersById.get(studentId);
      entries.push({
        userId: studentId,
        name: info?.name ?? "Unknown",
        isTutor: false,
        present: byUser.has(studentId),
        firstSeenAt: byUser.get(studentId) ?? null,
        hasDiscord: info?.hasDiscord ?? false,
      });
    }
    return entries;
  };

  const nowMs = Date.now();
  const result = (classes ?? []).map((cls) => ({
    classId: String(cls.id),
    title: cls.title ?? "",
    startsAt: cls.starts_at,
    durationHours:
      typeof cls.duration_hours === "number"
        ? cls.duration_hours
        : Number.parseFloat(String(cls.duration_hours ?? "1")) || 1,
    started: new Date(cls.starts_at).getTime() <= nowMs,
    roster: roster(String(cls.id)),
  }));

  return NextResponse.json({ courseTitle: course.title ?? "", classes: result });
}
