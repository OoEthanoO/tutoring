import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { resolveUserRole, isFounder } from "@/lib/roles";
import { ensureTutorApplicationsSchema } from "../../tutor-application/status/route";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
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

  // Resolve user role using custom roles
  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  
  const userRole = resolveUserRole(user.email, user.role ?? null, customRoleLevels);

  if (!isFounder(userRole)) {
    return NextResponse.json({ error: "Forbidden. Founder, CEO, or COO role required." }, { status: 403 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Ensure database schema is present
  await ensureTutorApplicationsSchema(adminClient);

  // Fetch all completed tutor applications
  const { data: applications, error } = await adminClient
    .from("tutor_applications")
    .select("id, user_id, full_name, email, phone_number, current_grade, parents_phone_number, subject_grades, programming_proficiency, debate_experience, other_courses_experience, consent_signature, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ applications: applications || [] });
}
