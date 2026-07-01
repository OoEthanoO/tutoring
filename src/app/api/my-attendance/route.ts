import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Returns the signed-in user's attendance for the past classes of the courses
 * they are enrolled in. Attendance is auto-recorded from Discord voice presence,
 * so a user with no linked Discord account cannot be auto-detected — the response
 * flags this so the UI can explain absences rather than show a false "Absent".
 */
export async function GET(request: NextRequest) {
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const [{ data: enrollments }, { data: selfRow }] = await Promise.all([
    adminClient
      .from("course_enrollments")
      .select("course:courses(id, title, deleted_at, course_classes(id, title, starts_at, duration_hours))")
      .eq("student_id", user.id),
    adminClient.from("app_users").select("discord_user_id").eq("id", user.id).single(),
  ]);

  const hasDiscord = Boolean(String(selfRow?.discord_user_id ?? "").trim());
  const nowMs = Date.now();

  type ClassRow = { id: string; title: string | null; starts_at: string; duration_hours: number | string | null };
  const pastClasses: {
    classId: string;
    courseId: string;
    courseTitle: string;
    classTitle: string;
    startsAt: string;
  }[] = [];
  const seen = new Set<string>();

  for (const row of enrollments ?? []) {
    // Supabase types a to-one embed as an array; it is a single object at runtime.
    const course = row.course as unknown as
      | { id: string; title: string | null; deleted_at: string | null; course_classes: ClassRow[] | null }
      | null;
    if (!course || course.deleted_at) {
      continue;
    }
    for (const cls of course.course_classes ?? []) {
      const startMs = new Date(cls.starts_at).getTime();
      if (Number.isNaN(startMs)) {
        continue;
      }
      const durationHours = Number.parseFloat(String(cls.duration_hours ?? "1"));
      const endMs = startMs + (Number.isFinite(durationHours) ? durationHours : 1) * 60 * 60 * 1000;
      if (endMs > nowMs || seen.has(cls.id)) {
        continue; // only classes that have already ended
      }
      seen.add(cls.id);
      pastClasses.push({
        classId: String(cls.id),
        courseId: String(course.id),
        courseTitle: course.title ?? "",
        classTitle: cls.title ?? "",
        startsAt: cls.starts_at,
      });
    }
  }

  // Which of those did this user attend?
  const attendedClassIds = new Set<string>();
  if (pastClasses.length > 0) {
    const { data: attendance } = await adminClient
      .from("class_attendance")
      .select("class_id")
      .eq("user_id", user.id)
      .in("class_id", pastClasses.map((c) => c.classId));
    for (const row of attendance ?? []) {
      attendedClassIds.add(String(row.class_id));
    }
  }

  const classes = pastClasses
    .map((c) => ({ ...c, attended: attendedClassIds.has(c.classId) }))
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  return NextResponse.json({ hasDiscord, classes });
}
