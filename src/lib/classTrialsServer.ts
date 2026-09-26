import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabasePaging";
import type { ClassTrial } from "@/lib/classTrials";

/** Never treat a missing table/failed page as an empty guest list: sync would kick guests. */
export async function loadClassTrials(db: SupabaseClient, classId?: string): Promise<ClassTrial[]> {
  const rows = await fetchAllRows((from, to) => {
    let query = db.from("class_trials").select(
      "id, class_id, discord_user_id, student_name, created_at, revoked_at, lesson:course_classes(id, course_id, title, starts_at, duration_hours, course:courses(id, title, deleted_at, is_completed))"
    ).order("id").range(from, to);
    if (classId) query = query.eq("class_id", classId);
    return query;
  });
  return rows.map(row => {
    const lesson = Array.isArray(row.lesson) ? row.lesson[0] : row.lesson;
    return { ...row, lesson: lesson ? { ...lesson, course: Array.isArray(lesson.course) ? lesson.course[0] : lesson.course } : null };
  }) as ClassTrial[];
}
