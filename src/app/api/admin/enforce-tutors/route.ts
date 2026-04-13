import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

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

  const role = resolveUserRole(user.email, user.role ?? null);
  if (role !== "founder") {
    return NextResponse.json({ error: "Only founders can perform this action." }, { status: 403 });
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

  // Find all users who are currently 'student' but have courses
  // To keep it simple, we just find all students and make sure they don't own courses
  const { data: students, error: userError } = await adminClient
    .from("app_users")
    .select("id, email, role");

  if (userError || !students) {
    return NextResponse.json(
      { error: "Failed to fetch users." },
      { status: 500 }
    );
  }

  const invalidTutorIds = students
    .filter((u) => resolveUserRole(u.email, u.role ?? null) === "student")
    .map((u) => u.id);

  if (invalidTutorIds.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }

  const { data: updatedCourses, error: updateError } = await adminClient
    .from("courses")
    .update({
      created_by: null,
      created_by_name: null,
      created_by_email: null,
    })
    .in("created_by", invalidTutorIds)
    .select("id");

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to enforce limbo courses rule." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, count: updatedCourses?.length ?? 0 });
}
