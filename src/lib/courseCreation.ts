import type { SupabaseClient } from "@supabase/supabase-js";
import { relabelClassesForCourse } from "@/lib/classTools";

/**
 * Writes a new course and its first classes. Shared by approving a course
 * request and by management creating a course directly, so both produce the
 * same row.
 */

export type NewCourseRow = {
  title: string;
  description: string | null;
  max_students: number | null;
  donation_fee: number | null;
  is_paid: boolean;
  paid_fee: number | null;
  grade_level: number | null;
  created_by: string;
  created_by_name: string;
  created_by_email: string | null;
  is_co_taught: boolean;
  co_tutor_id: string | null;
  co_tutor_name: string | null;
  co_tutor_email: string | null;
  recordings_enabled: boolean;
};

export type NewClassRow = { title: string; startsAt: string; durationHours: number; tutorId: string };

export type CourseCreationOutcome =
  | { ok: true; courseId: string; classesAdded: boolean }
  | { ok: false; error: string };

export const insertCourseWithClasses = async (
  adminClient: SupabaseClient,
  course: NewCourseRow,
  classes: NewClassRow[]
): Promise<CourseCreationOutcome> => {
  const { data: courseData, error: courseError } = await adminClient
    .from("courses")
    .insert({ ...course, is_completed: false })
    .select("id")
    .single();
  if (courseError || !courseData) {
    return { ok: false, error: courseError?.message ?? "Failed to create course." };
  }
  const courseId = String(courseData.id);

  if (classes.length === 0) {
    return { ok: true, courseId, classesAdded: true };
  }
  const { error: classError } = await adminClient.from("course_classes").insert(
    classes.map((item) => ({
      course_id: courseId,
      title: item.title,
      starts_at: item.startsAt,
      duration_hours: item.durationHours,
      created_by: item.tutorId,
    }))
  );
  if (classError) {
    // The course exists; its classes can be added by hand in My courses.
    console.error("Failed to add classes to course", courseId, classError);
    return { ok: true, courseId, classesAdded: false };
  }
  await relabelClassesForCourse(courseId, adminClient);
  return { ok: true, courseId, classesAdded: true };
};
