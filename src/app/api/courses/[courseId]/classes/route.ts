import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(
  request: NextRequest,
  { params }: { params: { courseId: string } | Promise<{ courseId: string }> }
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

  const resolvedParams = await params;
  const courseId = resolvedParams?.courseId ?? "";
  if (!courseId) {
    return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { title?: string; startsAt?: string; durationHours?: number }
    | null;

  const title = body?.title?.trim() ?? "";
  const startsAt = body?.startsAt?.trim() ?? "";
  const durationHours =
    typeof body?.durationHours === "number" && body.durationHours > 0
      ? body.durationHours
      : 1;

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (!startsAt) {
    return NextResponse.json(
      { error: "Start time is required." },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: course, error: courseError } = await adminClient
    .from("courses")
    .select("id, created_by")
    .eq("id", courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const isFounder = role === "founder";
  const isOwner = course.created_by === user.id;

  if (!isFounder && !isOwner) {
    return NextResponse.json(
      { error: "Only the course owner can add classes." },
      { status: 403 }
    );
  }

  const { data, error: insertError } = await adminClient
    .from("course_classes")
    .insert({
      course_id: courseId,
      title,
      starts_at: startsAt,
      duration_hours: durationHours,
      created_by: user.id,
    })
    .select("id, title, starts_at, duration_hours, created_at")
    .single();

  if (insertError || !data) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create class." },
      { status: 500 }
    );
  }

  return NextResponse.json({ class: data });
}
