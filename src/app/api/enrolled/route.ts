import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error: listError } = await adminClient
    .from("course_enrollments")
    .select(
      "course:courses(id, title, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, duration_hours, created_at))"
    )
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to load enrollments." },
      { status: 500 }
    );
  }

  const enrolledCourseIds = new Set(
    data.map((item) => {
      const c = item.course as unknown as { id: string } | null;
      return c?.id;
    }).filter(Boolean)
  );

  const enrolledCourses = data
    .map((item) => item.course)
    .filter(Boolean)
    .map((course) => ({ ...course, enrollment_status: "enrolled" }));

  // Also fetch pending/rejected enrollment requests
  const { data: requestData } = await adminClient
    .from("course_enrollment_requests")
    .select(
      "status, course:courses(id, title, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, duration_hours, created_at))"
    )
    .eq("student_id", user.id)
    .in("status", ["pending", "rejected"])
    .order("created_at", { ascending: false });

  const requestCourses = (requestData ?? [])
    .filter((item) => {
      const c = item.course as unknown as { id: string } | null;
      return c && !enrolledCourseIds.has(c.id);
    })
    .map((item) => ({
      ...(item.course as object),
      enrollment_status: item.status === "pending" ? "pending" : "rejected",
    }));

  const courses = [...enrolledCourses, ...requestCourses];

  return NextResponse.json({ courses });
}
