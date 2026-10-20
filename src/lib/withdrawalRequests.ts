import type { SupabaseClient } from "@supabase/supabase-js";
import {
  serviceHoursForClass,
  sumHours,
  withdrawableHourSteps,
} from "@/lib/serviceHours";

export type TutorAvailability = {
  availableHours: number;
  withdrawnHours: number;
  taughtClassCount: number;
  /** Per-class hours of the available classes, oldest first. */
  availableClassHours: number[];
  /** Valid withdrawal amounts: the running totals of `availableClassHours`. */
  hourSteps: number[];
};

// Availability math identical to the admin withdrawals POST handler (the source of
// truth): every past class in the tutor's non-deleted courses is worth the rate
// for its course's grade level (2 hours at grade 11/12, otherwise 1.5), minus
// classes already stamped with a tutor_withdrawal_id. Withdrawn hours come from
// the withdrawal records themselves, so past certificates stay authoritative even
// if a course's grade level is changed afterwards.
export async function getTutorAvailability(
  adminClient: SupabaseClient,
  tutorId: string
): Promise<TutorAvailability> {
  const empty: TutorAvailability = {
    availableHours: 0,
    withdrawnHours: 0,
    taughtClassCount: 0,
    availableClassHours: [],
    hourSteps: [],
  };

  const { data: courses } = await adminClient
    .from("courses")
    .select("id, grade_level")
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);

  const courseIds = (courses ?? []).map((c: { id: string }) => c.id);

  const { data: withdrawalRows } = await adminClient
    .from("tutor_withdrawals")
    .select("hours")
    .eq("tutor_id", tutorId);

  const withdrawnHours = sumHours(
    (withdrawalRows ?? []).map((row: { hours: number | string }) => Number(row.hours) || 0)
  );

  if (courseIds.length === 0) {
    return { ...empty, withdrawnHours };
  }

  const gradeByCourse = new Map(
    (courses ?? []).map((course: { id: string; grade_level: number | null }) => [
      course.id,
      course.grade_level,
    ])
  );

  const nowStr = new Date().toISOString();
  const { data: pastClasses } = await adminClient
    .from("course_classes")
    .select("id, course_id, duration_hours, tutor_withdrawal_id")
    .in("course_id", courseIds)
    .lte("starts_at", nowStr)
    .order("starts_at", { ascending: true });

  const taught = pastClasses ?? [];
  // Each class is worth its teaching time times the course rate, so how the
  // schedule is carved up does not change the total.
  const availableClassHours = taught
    .filter(
      (cls: { tutor_withdrawal_id: string | null }) => cls.tutor_withdrawal_id === null
    )
    .map((cls: { course_id: string; duration_hours: number | string | null }) =>
      serviceHoursForClass(cls.duration_hours, gradeByCourse.get(cls.course_id) ?? null)
    );

  return {
    availableHours: sumHours(availableClassHours),
    withdrawnHours,
    taughtClassCount: taught.length,
    availableClassHours,
    hourSteps: withdrawableHourSteps(availableClassHours),
  };
}
