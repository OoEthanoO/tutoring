import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type ClassRow = { starts_at: string; duration_hours: number | string | null };

type CourseRow = {
  id: string;
  title: string | null;
  is_completed: boolean | null;
  completed_start_date: string | null;
  completed_end_date: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  deleted_at: string | null;
  course_classes: ClassRow[] | null;
};

type CourseEntry = {
  id: string;
  title: string;
  tutor: string;
  classCount: number;
  startsAt: string | null;
  endsAt: string | null;
};

// Earliest class start and latest class end (start + duration) across a course.
const getClassBounds = (classes: ClassRow[]) => {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const cls of classes) {
    const start = new Date(cls.starts_at).getTime();
    if (Number.isNaN(start)) {
      continue;
    }
    const durationHours = Number.parseFloat(String(cls.duration_hours ?? "1"));
    const end = start + (Number.isFinite(durationHours) ? durationHours : 1) * 60 * 60 * 1000;
    startMs = Math.min(startMs, start);
    endMs = Math.max(endMs, end);
  }
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
  };
};

const sortByMs = (value: string | null) => {
  if (!value) {
    return 0;
  }
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Returns the courses a user is enrolled in, split into completed / ongoing /
 * future based on their class schedule. Founder-only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } | Promise<{ userId: string }> }
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const { userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "Missing userId." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await adminClient
    .from("course_enrollments")
    .select(
      "course:courses(id, title, is_completed, completed_start_date, completed_end_date, created_by_name, created_by_email, deleted_at, course_classes(starts_at, duration_hours))"
    )
    .eq("student_id", userId);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  const now = Date.now();
  const completed: CourseEntry[] = [];
  const ongoing: CourseEntry[] = [];
  const future: CourseEntry[] = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    // Supabase types a to-one embed as an array; it is a single object at runtime.
    const course = row.course as unknown as CourseRow | null;
    if (!course || course.deleted_at || seen.has(course.id)) {
      continue;
    }
    seen.add(course.id);

    const classes = Array.isArray(course.course_classes) ? course.course_classes : [];
    const { startMs, endMs } = getClassBounds(classes);
    const legacyCompleted = Boolean(course.completed_start_date && course.completed_end_date);

    const entry: CourseEntry = {
      id: course.id,
      title: (course.title ?? "").trim() || "Untitled course",
      tutor:
        (course.created_by_name ?? "").trim() ||
        (course.created_by_email ?? "").trim() ||
        "Unknown tutor",
      classCount: classes.length,
      startsAt: startMs !== null ? new Date(startMs).toISOString() : course.completed_start_date,
      endsAt: endMs !== null ? new Date(endMs).toISOString() : course.completed_end_date,
    };

    let bucket: CourseEntry[];
    if (course.is_completed || legacyCompleted) {
      bucket = completed;
    } else if (endMs !== null && endMs <= now) {
      bucket = completed;
    } else if (startMs !== null && startMs > now) {
      bucket = future;
    } else {
      // Started-but-not-ended, or has no scheduled classes yet.
      bucket = ongoing;
    }
    bucket.push(entry);
  }

  // Completed: most recently ended first. Ongoing/future: soonest first.
  completed.sort((a, b) => sortByMs(b.endsAt) - sortByMs(a.endsAt));
  ongoing.sort((a, b) => sortByMs(a.startsAt) - sortByMs(b.startsAt));
  future.sort((a, b) => sortByMs(a.startsAt) - sortByMs(b.startsAt));

  return NextResponse.json({ completed, ongoing, future });
}
