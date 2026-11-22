import { classEndMs } from "@/lib/classTiming";

/**
 * Which courses Explore → Courses table lists. Since November 2026 it shows
 * ongoing courses as well as upcoming ones (it used to drop a course once its
 * first class started, which left the table empty mid-term).
 */

export type CourseTableStatus = "upcoming" | "ongoing";

export type CourseTableCourse = {
  is_completed?: boolean | null;
  completed_start_date?: string | null;
  completed_end_date?: string | null;
  course_classes?: { starts_at: string; duration_hours: unknown }[] | null;
};

/**
 * "upcoming": no class has started yet (or none is scheduled).
 * "ongoing": the first class has started and a class has yet to end.
 * null: finished, or recorded as completed, so it is not listed.
 */
export const courseTableStatus = (course: CourseTableCourse, nowMs: number): CourseTableStatus | null => {
  if (course.is_completed || (course.completed_start_date && course.completed_end_date)) {
    return null;
  }
  const classes = (course.course_classes ?? [])
    .map((item) => ({ startMs: Date.parse(item.starts_at), durationHours: item.duration_hours }))
    .filter((item) => Number.isFinite(item.startMs));
  if (classes.length === 0) {
    return "upcoming";
  }
  if (Math.min(...classes.map((item) => item.startMs)) > nowMs) {
    return "upcoming";
  }
  const lastEndMs = Math.max(...classes.map((item) => classEndMs(item.startMs, item.durationHours)));
  return lastEndMs > nowMs ? "ongoing" : null;
};
