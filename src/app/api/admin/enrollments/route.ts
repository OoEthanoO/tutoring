import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { notifyCourseTutorsOfNewEnrollment } from "@/lib/courseChangeNotifications";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    courseId?: string;
  } | null;

  if (!body?.userId || !body?.courseId) {
    return NextResponse.json(
      { error: "Missing userId or courseId." },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 1. Get student info
  const { data: student, error: studentError } = await adminClient
    .from("app_users")
    .select("id, full_name, email")
    .eq("id", body.userId)
    .single();

  if (studentError || !student) {
    return NextResponse.json(
      { error: "Student not found." },
      { status: 404 }
    );
  }

  // 2. Get course info
  const { data: course, error: courseError } = await adminClient
    .from("courses")
    .select("id, title")
    .eq("id", body.courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json(
      { error: "Course not found." },
      { status: 404 }
    );
  }

  // 3. Create enrollment
  const { error: enrollmentError } = await adminClient
    .from("course_enrollments")
    .upsert(
      {
        course_id: body.courseId,
        student_id: body.userId,
        student_name: student.full_name,
        student_email: student.email,
      },
      { onConflict: "course_id,student_id" }
    );

  if (enrollmentError) {
    return NextResponse.json(
      { error: enrollmentError.message },
      { status: 500 }
    );
  }

  // 4. Create/Update enrollment request as approved
  await adminClient
    .from("course_enrollment_requests")
    .upsert({
      course_id: body.courseId,
      student_id: body.userId,
      student_name: student.full_name,
      student_email: student.email,
      status: "approved",
      decided_at: new Date().toISOString(),
    }, { onConflict: "course_id,student_id" });

  await notifyCourseTutorsOfNewEnrollment(
    adminClient,
    body.courseId,
    String(student.full_name ?? "").trim(),
    student.email ?? null
  );

  return NextResponse.json({ success: true });
}
