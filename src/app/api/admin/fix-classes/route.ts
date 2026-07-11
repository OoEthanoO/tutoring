import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { relabelClassesForCourse } from "@/lib/classTools";

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

  const { data: courses, error: coursesError } = await adminClient
    .from("courses")
    .select("id");

  if (coursesError || !courses) {
    return NextResponse.json(
      { error: coursesError?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  try {
    for (const course of courses) {
      await relabelClassesForCourse(course.id, adminClient);
    }

    return NextResponse.json({ success: true, count: courses.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An error occurred during class relabeling." },
      { status: 500 }
    );
  }
}
