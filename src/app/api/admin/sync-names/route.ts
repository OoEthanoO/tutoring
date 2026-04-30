import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: users, error: fetchError } = await adminClient
    .from("app_users")
    .select("id, full_name");

  if (fetchError || !users) {
    return NextResponse.json(
      { error: fetchError?.message ?? "Failed to fetch users." },
      { status: 500 }
    );
  }

  let coursesUpdated = 0;
  let enrollmentsUpdated = 0;
  let requestsUpdated = 0;

  // Process in chunks to avoid overwhelming the database while still being fast
  const chunkSize = 20;
  for (let i = 0; i < users.length; i += chunkSize) {
    const chunk = users.slice(i, i + chunkSize);
    
    await Promise.all(
      chunk.map(async (u) => {
        const name = (u.full_name || "").trim();
        if (!name) return;

        const [cRes, eRes, rRes] = await Promise.all([
          adminClient
            .from("courses")
            .update({ created_by_name: name })
            .eq("created_by", u.id)
            .select("id"),
          adminClient
            .from("course_enrollments")
            .update({ student_name: name })
            .eq("student_id", u.id)
            .select("id"),
          adminClient
            .from("course_enrollment_requests")
            .update({ student_name: name })
            .eq("student_id", u.id)
            .select("id")
        ]);

        if (cRes.data) coursesUpdated += cRes.data.length;
        if (eRes.data) enrollmentsUpdated += eRes.data.length;
        if (rRes.data) requestsUpdated += rRes.data.length;
      })
    );
  }

  return NextResponse.json({
    success: true,
    coursesUpdated,
    enrollmentsUpdated,
    requestsUpdated,
  });
}
