"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotification } from "./Notification";

interface Course {
  id: string;
  title: string;
  created_by_name?: string | null;
  donation_fee?: number;
  completed_class_count?: number | null;
  is_completed?: boolean;
  completed_start_date?: string | null;
  completed_end_date?: string | null;
  course_classes?: CourseClass[];
}

interface CourseClass {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
}

interface ClassesByDay {
  [day: string]: string[];
}

interface ScheduleData {
  byDay: ClassesByDay;
  isIrregular: boolean;
  summary: string;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const formatTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes === 0 ? "" : minutes.toString().padStart(2, "0");
  return `${displayHours}${displayMinutes}${ampm}`;
};

const getScheduleData = (classes: CourseClass[] | undefined): ScheduleData => {
  if (!classes || classes.length === 0) {
    return { byDay: {}, isIrregular: false, summary: "No classes" };
  }

  const classMap = new Map<string, Set<string>>();

  // Group classes by day of week
  classes.forEach((cls) => {
    const date = new Date(cls.starts_at);
    // Convert JS day (0=Sunday) to our DAYS_OF_WEEK (0=Monday)
    const jsDay = date.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const dayName = DAYS_OF_WEEK[dayIndex];

    const start = formatTime(date);
    const endDate = new Date(date.getTime() + cls.duration_hours * 60 * 60 * 1000);
    const end = formatTime(endDate);
    const timeRange = `${start}-${end}`;

    if (!classMap.has(dayName)) {
      classMap.set(dayName, new Set());
    }
    classMap.get(dayName)!.add(timeRange);
  });

  // Check if schedule is irregular (has very few classes or many one-off dates)
  const daysWithClasses = classMap.size;
  const totalUniqueTimes = Array.from(classMap.values()).reduce((sum, set) => sum + set.size, 0);
  // Irregular if: spans too many weeks, has very few consistent slots, or too many classes
  const isIrregular =
    classes.length > 15 || (totalUniqueTimes === classes.length && classes.length < 5) || daysWithClasses > 5;

  // Build summary for irregular schedules
  let summary = "";
  if (isIrregular) {
    const sortedClasses = [...classes].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

    // Group by date
    const byDate = new Map<string, { start: string; end: string }[]>();
    let totalHours = 0;

    sortedClasses.forEach((cls) => {
      const date = new Date(cls.starts_at);
      const dateStr = date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

      const start = formatTime(date);
      const endDate = new Date(date.getTime() + cls.duration_hours * 60 * 60 * 1000);
      const end = formatTime(endDate);

      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, []);
      }
      byDate.get(dateStr)!.push({ start, end });
      totalHours += cls.duration_hours;
    });

    // Format as: "HH-HHpm, HH-HHpm, ... N classes, M hours. Date1, Date2, ..."
    const timeStrings: string[] = [];
    byDate.forEach((times) => {
      times.forEach((t) => {
        timeStrings.push(`${t.start}-${t.end}`);
      });
    });
    const dateStrings = Array.from(byDate.keys());

    summary = `${timeStrings.join(", ")} ${classes.length} classes, ${totalHours} hours. ${dateStrings.join(", ")}`;
  }

  // Convert sets to sorted arrays
  const byDay: ClassesByDay = {};
  classMap.forEach((timeSet, day) => {
    byDay[day] = Array.from(timeSet).sort();
  });

  return { byDay, isIrregular, summary };
};

const formatScheduleCell = (classes: CourseClass[] | undefined) => {
  const schedule = getScheduleData(classes);
  return schedule;
};

export default function AllCoursesTableMenu() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showNotification } = useNotification();
  const visibleCourses = useMemo(() => {
    const now = Date.now();
    return courses.filter((course) => {
      const isLegacyCompletedCourse =
        Boolean(course.is_completed) ||
        Boolean(course.completed_start_date && course.completed_end_date);

      if (isLegacyCompletedCourse) {
        return false;
      }

      return !(course.course_classes ?? []).some((courseClass) => {
        const startsAt = new Date(courseClass.starts_at).getTime();
        return Number.isFinite(startsAt) && startsAt <= now;
      });
    });
  }, [courses]);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/courses");

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to fetch courses");
        }

        const payload = (await response.json()) as { courses?: Course[] };
        setCourses(payload.courses ?? []);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error fetching courses:", errorMessage);
        showNotification(`Failed to load courses: ${errorMessage}`, "error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchCourses();
  }, [showNotification]);

  if (isLoading) {
    return <div className="py-8 text-center text-[var(--muted)]">Loading courses...</div>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--background-secondary)]">
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Course</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Tutor</th>
            <th className="border border-[var(--border)] px-4 py-3 text-center font-semibold">Classes</th>
            <th className="border border-[var(--border)] px-4 py-3 text-center font-semibold">Fee</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Period</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Monday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Tuesday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Wednesday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Thursday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Friday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Saturday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Sunday</th>
            <th className="border border-[var(--border)] px-4 py-3 text-left font-semibold">Special Dates</th>
          </tr>
        </thead>
        <tbody>
          {visibleCourses.map((course) => {
            const schedule = formatScheduleCell(course.course_classes);
            const classCount = course.completed_class_count ?? course.course_classes?.length ?? 0;
            const periodLabel =
              course.completed_start_date && course.completed_end_date
                ? `${new Date(course.completed_start_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })} - ${new Date(course.completed_end_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}`
                : "N/A";

            // Determine if we should use expanded or compact view
            if (schedule.isIrregular) {
              // Irregular schedule - collapse columns 6-13 into one
              return (
                <tr key={course.id} className="border-b border-[var(--border)] hover:bg-[var(--background-secondary)]">
                  <td className="border border-[var(--border)] px-4 py-3">{course.title}</td>
                  <td className="border border-[var(--border)] px-4 py-3">{course.created_by_name || "N/A"}</td>
                  <td className="border border-[var(--border)] px-4 py-3 text-center">
                    {classCount}
                  </td>
                  <td className="border border-[var(--border)] px-4 py-3 text-center">
                    ${course.donation_fee || 0}
                  </td>
                  <td className="border border-[var(--border)] px-4 py-3 text-xs">{periodLabel}</td>
                  <td
                    colSpan={8}
                    className="border border-[var(--border)] px-4 py-3 text-xs italic text-[var(--muted)]"
                  >
                    {schedule.summary}
                  </td>
                </tr>
              );
            }

            // Regular schedule - show by day
            return (
              <tr key={course.id} className="border-b border-[var(--border)] hover:bg-[var(--background-secondary)]">
                <td className="border border-[var(--border)] px-4 py-3">{course.title}</td>
                <td className="border border-[var(--border)] px-4 py-3">{course.created_by_name || "N/A"}</td>
                <td className="border border-[var(--border)] px-4 py-3 text-center">
                  {classCount}
                </td>
                <td className="border border-[var(--border)] px-4 py-3 text-center">
                  ${course.donation_fee || 0}
                </td>
                <td className="border border-[var(--border)] px-4 py-3 text-xs">{periodLabel}</td>
                {DAYS_OF_WEEK.map((day) => (
                  <td key={day} className="border border-[var(--border)] px-4 py-3 text-xs">
                    {schedule.byDay[day] && schedule.byDay[day].length > 0
                      ? schedule.byDay[day]
                          .join(" ")
                      : ""}
                  </td>
                ))}
                <td className="border border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
                  {/* Special dates would go here if available */}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {visibleCourses.length === 0 && (
        <div className="py-8 text-center text-[var(--muted)]">No courses found</div>
      )}
    </div>
  );
}
