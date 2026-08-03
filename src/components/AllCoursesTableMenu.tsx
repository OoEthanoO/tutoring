"use client";

import { useEffect, useMemo, useState } from "react";
import { useNotification } from "./Notification";
import { classEndMs } from "@/lib/classTiming";

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
  specialDates: string[];
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const formatTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  if (minutes === 0) return `${displayHours} ${ampm}`;
  const displayMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${displayMinutes} ${ampm}`;
};

const getScheduleData = (classes: CourseClass[] | undefined): ScheduleData => {
  if (!classes || classes.length === 0) {
    return { byDay: {}, isIrregular: false, summary: "No classes", specialDates: [] };
  }

  // First, identify which dates are special (on outlier days)
  const specialDateSet = new Set<string>();
  if (classes.length > 5) {
    const dayFrequency = new Map<string, number>();
    const datesByDay = new Map<string, Set<string>>();
    
    classes.forEach((cls) => {
      const date = new Date(cls.starts_at);
      const jsDay = date.getDay();
      const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
      const dayName = DAYS_OF_WEEK[dayIndex];
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      
      dayFrequency.set(dayName, (dayFrequency.get(dayName) || 0) + 1);
      if (!datesByDay.has(dayName)) {
        datesByDay.set(dayName, new Set());
      }
      datesByDay.get(dayName)!.add(dateStr);
    });
    
    // Find days with lower frequency (outliers)
    const frequencies = Array.from(dayFrequency.values());
    const maxFreq = Math.max(...frequencies);
    const outlierThreshold = Math.ceil(maxFreq * 0.5);
    
    // Mark dates from outlier days as special
    dayFrequency.forEach((freq, day) => {
      if (freq < outlierThreshold && freq < 3) {
        const dates = datesByDay.get(day);
        if (dates) {
          dates.forEach(d => specialDateSet.add(d));
        }
      }
    });
  }

  const classMap = new Map<string, Set<string>>();

  // Group classes by day of week, but exclude special dates
  classes.forEach((cls) => {
    const date = new Date(cls.starts_at);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    
    // Skip special dates - they'll only appear in Special Dates column
    if (specialDateSet.has(dateStr)) {
      return;
    }

    // Convert JS day (0=Sunday) to our DAYS_OF_WEEK (0=Monday)
    const jsDay = date.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const dayName = DAYS_OF_WEEK[dayIndex];

    const start = formatTime(date);
    const endDate = new Date(classEndMs(date.getTime(), cls.duration_hours));
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
  // Irregular if the weekly pattern doesn't hold: every class is a one-off, classes
  // span too many days of the week, or there are too many distinct time slots.
  // Note: total class count is NOT a signal — a regular course (e.g. every Thu & Sat)
  // run over a full semester legitimately has many sessions.
  const isIrregular =
    (totalUniqueTimes === classes.length && classes.length < 5) || daysWithClasses > 5 || totalUniqueTimes > 7;

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
      const endDate = new Date(classEndMs(date.getTime(), cls.duration_hours));
      const end = formatTime(endDate);

      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, []);
      }
      byDate.get(dateStr)!.push({ start, end });
      totalHours += cls.duration_hours;
    });

    // Build a list of unique time ranges so we don't repeat the same time many times
    const uniqueTimeSet = new Set<string>();
    byDate.forEach((times) => {
      times.forEach((t) => {
        uniqueTimeSet.add(`${t.start}-${t.end}`);
      });
    });
    const timeStrings = Array.from(uniqueTimeSet.values());
    const dateStrings = Array.from(byDate.keys());

    summary = `${timeStrings.join(", ")} — ${classes.length} classes, ${Math.round(totalHours)} hours. ${dateStrings.join(", ")}`;
  }

  // Convert sets to sorted arrays
  const byDay: ClassesByDay = {};
  classMap.forEach((timeSet, day) => {
    byDay[day] = Array.from(timeSet).sort();
  });

  // Convert special date set to sorted array
  const specialDates = Array.from(specialDateSet).sort();

  return { byDay, isIrregular, summary, specialDates };
};

const formatScheduleCell = (classes: CourseClass[] | undefined) => {
  const schedule = getScheduleData(classes);
  return schedule;
};

// The first number appearing in a course title is treated as its grade number.
// Returns null when the title has no number.
const getCourseGradeNumber = (title: string | null | undefined): number | null => {
  if (!title) {
    return null;
  }
  const match = title.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
};

export default function AllCoursesTableMenu() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showNotification } = useNotification();
  const visibleCourses = useMemo(() => {
    const now = Date.now();
    const filtered = courses.filter((course) => {
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

    // Courses with a grade number (first number in the title) come first,
    // ordered by grade ascending. Courses without one keep their existing
    // relative order below them (Array.sort is stable).
    return filtered.sort((a, b) => {
      const gradeA = getCourseGradeNumber(a.title);
      const gradeB = getCourseGradeNumber(b.title);

      if (gradeA !== null && gradeB !== null) {
        return gradeA - gradeB;
      }
      if (gradeA !== null) {
        return -1;
      }
      if (gradeB !== null) {
        return 1;
      }
      return 0;
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
    <div className="overflow-x-auto">
      <table className="border-collapse table-fixed text-[12px]">
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '4%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--background-secondary)]">
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Course</th>
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Tutor</th>
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Classes</th>
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Donation</th>
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Period</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Mon</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Tue</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Wed</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Thu</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Fri</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Sat</th>
            <th className="border border-[var(--border)] px-1 py-1 text-center font-semibold leading-tight whitespace-nowrap">Sun</th>
            <th className="border border-[var(--border)] px-2 py-1 text-center font-semibold leading-tight">Special</th>
          </tr>
        </thead>
        <tbody>
          {visibleCourses.map((course) => {
            const schedule = formatScheduleCell(course.course_classes);
            const classCount = course.completed_class_count ?? course.course_classes?.length ?? 0;
            // Compute period from course classes when available, otherwise fall back to completed_* fields
            let periodLabel = "N/A";
            const cls = course.course_classes ?? [];
            if (cls.length > 0) {
              const starts = cls
                .map((c) => new Date(c.starts_at).getTime())
                .filter(Number.isFinite)
                .sort((a, b) => a - b);
              if (starts.length > 0) {
                const first = new Date(starts[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const last = new Date(starts[starts.length - 1]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                periodLabel = `${first} - ${last}`;
              }
            } else if (course.completed_start_date && course.completed_end_date) {
              periodLabel = `${new Date(course.completed_start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(course.completed_end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
            }

            // Determine if we should use expanded or compact view
            if (schedule.isIrregular) {
              // Irregular schedule - collapse columns 6-13 into one
              return (
                <tr key={course.id} className="border-b border-[var(--border)] hover:bg-[var(--background-secondary)]">
                  <td className="border border-[var(--border)] px-2 py-1 truncate leading-tight text-center whitespace-nowrap" title={course.title}>{course.title}</td>
                  <td className="border border-[var(--border)] px-2 py-1 truncate leading-tight text-center whitespace-nowrap" title={course.created_by_name || ""}>{course.created_by_name || "N/A"}</td>
                  <td className="border border-[var(--border)] px-2 py-1 text-center leading-tight">{classCount}</td>
                  <td className="border border-[var(--border)] px-2 py-1 text-center leading-tight">${course.donation_fee || 0}</td>
                  <td className="border border-[var(--border)] px-2 py-1 text-xs leading-tight text-center whitespace-nowrap">{periodLabel}</td>
                  <td
                    colSpan={8}
                    className="border border-[var(--border)] px-2 py-1 text-xs italic text-[var(--muted)] leading-tight text-center"
                  >
                    {schedule.summary}
                  </td>
                </tr>
              );
            }

            // Regular schedule - show by day
            return (
              <tr key={course.id} className="border-b border-[var(--border)] hover:bg-[var(--background-secondary)]">
                <td className="border border-[var(--border)] px-2 py-1 truncate leading-tight text-center whitespace-nowrap" title={course.title}>{course.title}</td>
                <td className="border border-[var(--border)] px-2 py-1 truncate leading-tight text-center whitespace-nowrap" title={course.created_by_name || ""}>{course.created_by_name || "N/A"}</td>
                <td className="border border-[var(--border)] px-2 py-1 text-center leading-tight">{classCount}</td>
                <td className="border border-[var(--border)] px-2 py-1 text-center leading-tight">${course.donation_fee || 0}</td>
                <td className="border border-[var(--border)] px-2 py-1 text-xs leading-tight text-center whitespace-nowrap">{periodLabel}</td>
                {DAYS_OF_WEEK.map((day) => (
                  <td key={day} className="border border-[var(--border)] px-1 py-1 text-xs leading-tight whitespace-nowrap text-center">
                    {schedule.byDay[day] && schedule.byDay[day].length > 0 ? schedule.byDay[day].join(" ") : ""}
                  </td>
                ))}
                <td className="border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] leading-tight whitespace-nowrap text-center">{schedule.specialDates.length > 0 ? schedule.specialDates.join(", ") : ""}</td>
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
