import type { SupabaseClient } from "@supabase/supabase-js";
import { courseIsActive, paidCourseBlocker, type PaidCourseTutor } from "@/lib/paidCourses";

/**
 * Database reads behind the paid-course rules in `paidCourses.ts`. Every
 * function here takes the service-role client; the rules themselves stay pure.
 */

/** Senior standing and payment note for each of these accounts. */
export async function loadPaidCourseTutors(
  adminClient: SupabaseClient,
  userIds: (string | null | undefined)[]
): Promise<Map<string, PaidCourseTutor>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const standing = new Map<string, PaidCourseTutor>();
  if (ids.length === 0) {
    return standing;
  }

  const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      adminClient.from("app_users").select("id, senior_tutor").in("id", ids),
      adminClient.from("tutor_profiles").select("user_id, payment_note").in("user_id", ids),
    ]);
  if (usersError || profilesError) {
    throw new Error(usersError?.message ?? profilesError?.message ?? "Could not read tutor standing.");
  }

  const notes = new Map(
    (profiles ?? []).map((row: { user_id: string; payment_note: string | null }) => [
      row.user_id,
      row.payment_note,
    ])
  );
  (users ?? []).forEach((row: { id: string; senior_tutor: boolean | null }) => {
    standing.set(row.id, {
      seniorTutor: Boolean(row.senior_tutor),
      paymentNote: notes.get(row.id) ?? null,
    });
  });
  return standing;
}

/**
 * Why a course with this tutor (and co-tutor, when co-taught) cannot be a paid
 * course at this fee, or null when it can.
 */
export async function findPaidCourseBlocker(
  adminClient: SupabaseClient,
  input: { ownerId: string | null | undefined; coTutorId?: string | null; fee: unknown }
): Promise<string | null> {
  const tutors = await loadPaidCourseTutors(adminClient, [input.ownerId, input.coTutorId]);
  return paidCourseBlocker({
    owner: input.ownerId ? tutors.get(input.ownerId) ?? null : null,
    // A co-tutor whose account is gone cannot be vouched for either.
    coTutor: input.coTutorId
      ? tutors.get(input.coTutorId) ?? { seniorTutor: false }
      : null,
    fee: input.fee,
  });
}

/** How many paid courses this tutor owns or co-teaches that are still running. */
export async function countActivePaidCourses(
  adminClient: SupabaseClient,
  tutorId: string
): Promise<number> {
  const { data, error } = await adminClient
    .from("courses")
    .select("id, is_completed, deleted_at, course_classes(starts_at, duration_hours)")
    .eq("is_paid", true)
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);
  if (error) {
    throw new Error(error.message);
  }
  const now = Date.now();
  return (data ?? []).filter((course) => courseIsActive(course, now)).length;
}
