import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { isRecordingWatchable } from "@/lib/recordings";

export const dynamic = "force-dynamic";

type RecordingListRow = {
  id: string;
  class_id: string;
  course_id: string;
  tutor_id: string;
  status: string;
  duration_seconds: number | null;
  uploaded_at: string | null;
  expires_at: string | null;
  course: { title: string | null; created_by: string | null; co_tutor_id: string | null; created_by_name: string | null } | null;
  class: { title: string | null; starts_at: string | null } | null;
};

/**
 * Recordings the signed-in user may watch: founders see everything, tutors
 * their own courses, students the courses they are enrolled in. Only ready,
 * unexpired recordings are listed — nothing here ever exposes a storage path.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = getAdminClient();
  const role = resolveUserRole(user.email, user.role ?? null);
  const nowMs = Date.now();

  const [{ data: rows, error }, { data: enrollments }] = await Promise.all([
    adminClient
      .from("class_recordings")
      .select(
        "id, class_id, course_id, tutor_id, status, duration_seconds, uploaded_at, expires_at, course:courses(title, created_by, co_tutor_id, created_by_name), class:course_classes(title, starts_at)"
      )
      .eq("status", "ready")
      .gt("expires_at", new Date(nowMs).toISOString())
      .order("uploaded_at", { ascending: false })
      .limit(200),
    adminClient.from("course_enrollments").select("course_id").eq("student_id", user.id),
  ]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enrolledCourseIds = new Set((enrollments ?? []).map((row) => String(row.course_id)));
  const founder = isFounder(role);

  const recordings = ((rows ?? []) as unknown as RecordingListRow[])
    .map((row) => ({
      ...row,
      // Supabase types a to-one embed as an array; it is a single object at runtime.
      course: Array.isArray(row.course) ? row.course[0] ?? null : row.course,
      class: Array.isArray(row.class) ? row.class[0] ?? null : row.class,
    }))
    .filter((row) => {
      if (!isRecordingWatchable(row, nowMs)) {
        return false;
      }
      if (founder || row.tutor_id === user.id) {
        return true;
      }
      if (row.course?.created_by === user.id || row.course?.co_tutor_id === user.id) {
        return true;
      }
      return enrolledCourseIds.has(String(row.course_id));
    })
    .map((row) => ({
      id: row.id,
      classId: row.class_id,
      courseId: row.course_id,
      courseTitle: row.course?.title ?? "",
      classTitle: row.class?.title ?? "",
      tutorName: row.course?.created_by_name ?? "",
      classStartsAt: row.class?.starts_at ?? null,
      durationSeconds: row.duration_seconds,
      uploadedAt: row.uploaded_at,
      expiresAt: row.expires_at,
      viewerRole:
        founder || row.tutor_id === user.id || row.course?.created_by === user.id || row.course?.co_tutor_id === user.id
          ? "tutor"
          : "student",
    }));

  return NextResponse.json({ recordings });
}
