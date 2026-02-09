import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const isFiveMinuteSharp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return (
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0 &&
    parsed.getUTCMinutes() % 5 === 0
  );
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { classId: string } | Promise<{ classId: string }> }
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
  const classId = resolvedParams?.classId ?? "";
  if (!classId) {
    return NextResponse.json({ error: "Missing class id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { title?: string; startsAt?: string; durationHours?: number }
    | null;

  const nextTitle = body?.title?.trim();
  const nextStartsAt = body?.startsAt?.trim();

  if (!nextTitle && !nextStartsAt) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  if (nextStartsAt && !isFiveMinuteSharp(nextStartsAt)) {
    return NextResponse.json(
      {
        error:
          "Start time must be on a 5-minute mark (for example 12:00, 12:05, 12:10).",
      },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: classRow, error: classError } = await adminClient
    .from("course_classes")
    .select("id, course_id, title, starts_at, duration_hours")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return NextResponse.json(
      { error: classError?.message ?? "Class not found." },
      { status: 404 }
    );
  }

  const { data: courseRow, error: courseError } = await adminClient
    .from("courses")
    .select("id, created_by")
    .eq("id", classRow.course_id)
    .single();

  if (courseError || !courseRow) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const isFounder = role === "founder";
  const isOwner = courseRow.created_by === user.id;
  if (!isFounder && !isOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const updates: Record<string, string | number> = {};
  if (nextTitle) {
    updates.title = nextTitle;
  }
  if (nextStartsAt) {
    updates.starts_at = nextStartsAt;
  }
  updates.duration_hours = 1;

  const { data: updated, error: updateError } = await adminClient
    .from("course_classes")
    .update(updates)
    .eq("id", classId)
    .select("id, title, starts_at, duration_hours, created_at")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update class." },
      { status: 500 }
    );
  }

  return NextResponse.json({ class: updated });
}
