import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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

  let query = adminClient
    .from("courses")
    .select(
      "id, title, short_name, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, duration_hours, created_at), course_enrollments(id, student_id, student_name, student_email, created_at)"
    )
    .order("created_at", { ascending: false });

  if (role === "executive") {
    query = query.eq("created_by", user.id);
  }

  const { data, error: listError } = await query;

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  // Enrich enrollments with grade/school from app_users
  const studentIds = Array.from(
    new Set(
      data.flatMap((course: Record<string, unknown>) =>
        ((course.course_enrollments as Array<Record<string, unknown>>) ?? []).map(
          (e) => e.student_id as string
        )
      ).filter(Boolean)
    )
  );

  let gradeSchoolMap = new Map<string, { grade: string; school: string }>();
  if (studentIds.length > 0) {
    const { data: studentData } = await adminClient
      .from("app_users")
      .select("id, grade, school")
      .in("id", studentIds);

    gradeSchoolMap = new Map(
      (studentData ?? []).map((row) => [
        row.id as string,
        { grade: (row.grade as string) ?? "", school: (row.school as string) ?? "" },
      ])
    );
  }

  const enrichedCourses = data.map((course: Record<string, unknown>) => ({
    ...course,
    course_enrollments: (
      (course.course_enrollments as Array<Record<string, unknown>>) ?? []
    ).map((enrollment) => {
      const info = gradeSchoolMap.get(enrollment.student_id as string);
      return {
        ...enrollment,
        student_grade: info?.grade ?? "",
        student_school: info?.school ?? "",
      };
    }),
  }));

  return NextResponse.json({ courses: enrichedCourses });
}
