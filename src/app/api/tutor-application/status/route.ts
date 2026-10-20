import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Fetch the application for the current user
  const { data: application, error } = await adminClient
    .from("tutor_applications")
    .select("id, full_name, email, phone_number, current_grade, parents_phone_number, subject_grades, programming_proficiency, debate_experience, other_courses_experience, consent_signature, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error fetching tutor application:", error);
    return NextResponse.json({ completed: false, application: null });
  }

  return NextResponse.json({
    completed: Boolean(application),
    application: application || null,
  });
}
