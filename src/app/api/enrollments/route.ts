import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
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

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
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

  const { data: requests, error: listError } = await adminClient
    .from("course_enrollment_requests")
    .select(
      "id, status, created_at, student_id, course_id, student_name, student_email, course:courses(id, title, created_by, created_by_name, created_by_email, max_students, course_enrollments(count))"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (listError || !requests) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to load requests." },
      { status: 500 }
    );
  }

  // Fetch student applications for these requests
  const studentIds = requests.map(r => r.student_id);
  const courseIds = requests.map(r => r.course_id);

  const { data: applications, error: appsError } = await adminClient
    .from("student_applications")
    .select("*")
    .in("student_id", studentIds)
    .in("course_id", courseIds);

  const requestsWithApps = requests.map(request => {
    const application = applications?.find(
      app => app.student_id === request.student_id && app.course_id === request.course_id
    );
    return {
      ...request,
      student_application: application || null
    };
  });

  return NextResponse.json({ requests: requestsWithApps });
}
