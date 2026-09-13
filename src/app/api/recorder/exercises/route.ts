import { getRecorderUser } from "@/lib/recorderAuth";
import { getAdminClient } from "@/lib/authServer";
import { isFounder } from "@/lib/roles";
import { exerciseJson, exerciseFailure, ExerciseError } from "@/lib/classExercisesServer";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await getRecorderUser(request);
    if (!user) throw new ExerciseError("Sign in with your tutor account.", 401);
    // Independent of Recorder's recording mandate and voice-channel presence.
    let query = getAdminClient().from("courses")
      .select("id, title, course_classes(id, title, starts_at, duration_hours)").is("deleted_at", null);
    if (!isFounder(user.resolvedRole)) query = query.or(`created_by.eq.${user.id},co_tutor_id.eq.${user.id}`);
    const { data, error } = await query;
    if (error) throw error;
    const now = Date.now();
    const classes = (data ?? []).flatMap(course => (course.course_classes ?? []).map(lesson => ({
      id: lesson.id, courseTitle: course.title, title: lesson.title, startsAt: lesson.starts_at,
      endsAt: new Date(Date.parse(lesson.starts_at) + Number(lesson.duration_hours || 1) * 3600000).toISOString(),
    }))).filter(lesson => {
      const date = Date.parse(lesson.startsAt);
      return date >= now - 30 * 86400000 && date <= now + 30 * 86400000;
    }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return exerciseJson({ classes, serverNow: now });
  } catch (error) { return exerciseFailure(error); }
}
