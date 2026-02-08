import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params:
      | { enrollmentId: string }
      | Promise<{ enrollmentId: string }>;
  }
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

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const enrollmentId = resolvedParams?.enrollmentId ?? "";
  if (!enrollmentId) {
    return NextResponse.json(
      { error: "Missing enrollment id." },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: enrollment, error: enrollmentError } = await adminClient
    .from("course_enrollments")
    .select("id, course_id, student_id")
    .eq("id", enrollmentId)
    .single();

  if (enrollmentError || !enrollment) {
    return NextResponse.json(
      { error: enrollmentError?.message ?? "Enrollment not found." },
      { status: 404 }
    );
  }

  const { error } = await adminClient
    .from("course_enrollments")
    .delete()
    .eq("id", enrollmentId);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to remove enrolled student." },
      { status: 500 }
    );
  }

  await adminClient
    .from("course_enrollment_requests")
    .delete()
    .eq("course_id", enrollment.course_id)
    .eq("student_id", enrollment.student_id)
    .in("status", ["approved", "pending"]);

  return NextResponse.json({ success: true });
}
