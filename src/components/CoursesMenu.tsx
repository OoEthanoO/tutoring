"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";

type StatusState = {
  type: "idle" | "error";
  message: string;
};

type CourseClass = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
  created_at: string;
};

const sortClassesByStart = (classes: CourseClass[]) =>
  [...classes].sort(
    (a, b) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  );

const getClassTimes = (startsAt: string) => {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
};

const formatClassSchedule = (start: Date, end: Date) => {
  const date = start.toLocaleDateString();
  const startTime = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${startTime} - ${endTime}`;
};

const getClassTimeStyle = (start: Date, end: Date) => {
  const now = new Date();
  if (now >= start && now <= end) {
    return "text-amber-400 animate-pulse";
  }
  if (end < now) {
    return "text-emerald-400 line-through";
  }
  return "text-[var(--muted)]";
};

type Course = {
  id: string;
  title: string;
  description: string | null;
  is_completed?: boolean;
  completed_start_date?: string | null;
  completed_end_date?: string | null;
  completed_class_count?: number | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  course_classes: CourseClass[];
  enrollment_status?: "pending" | "approved" | "rejected" | "enrolled" | null;
  donation_link?: string | null;
};

const formatCompletedDate = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString();
};

const isEnrollmentClosed = (course: Course) => {
  const now = Date.now();
  const classStarts = (course.course_classes ?? [])
    .map((item) => new Date(item.starts_at).getTime())
    .filter((value) => Number.isFinite(value));
  const hasFutureClass = classStarts.some((startsAt) => startsAt > now);
  return !hasFutureClass;
};

export default function CoursesMenu() {
  const [userId, setUserId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => new Date().getTime());
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setUserId(user?.id ?? null);
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!userId) {
      setCourses([]);
      return;
    }

    const loadCourses = async () => {
      setIsLoadingCourses(true);
      const response = await fetch("/api/courses");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to load courses.",
        });
        setIsLoadingCourses(false);
        return;
      }

      const data = (await response.json()) as { courses: Course[] };
      setCourses(data.courses ?? []);
      setIsLoadingCourses(false);
    };

    loadCourses();
  }, [userId]);

  const hasFutureClass = (course: Course) => !isEnrollmentClosed(course);

  const availableCourses = useMemo(
    () => courses.filter((course) => hasFutureClass(course)),
    [courses]
  );

  const upcomingCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          !hasFutureClass(course) &&
          !course.is_completed &&
          (!course.course_classes || course.course_classes.length === 0)
      ),
    [courses]
  );

  const completedCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          !hasFutureClass(course) &&
          (course.is_completed ||
            (course.course_classes && course.course_classes.length > 0))
      ),
    [courses]
  );

  const totalClassTimeMinutes = useMemo(() => {
    const minutes = courses.reduce((sum, course) => {
      if (course.is_completed) {
        const completedCount =
          typeof course.completed_class_count === "number"
            ? course.completed_class_count
            : 0;
        const safeCompletedCount =
          Number.isFinite(completedCount) && completedCount > 0
            ? completedCount
            : 0;
        return sum + safeCompletedCount * 60;
      }

      const classMinutes = (course.course_classes ?? []).reduce(
        (classSum, courseClass) => {
          const { start, end } = getClassTimes(courseClass.starts_at);
          const startMs = start.getTime();
          const endMs = end.getTime();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            return classSum;
          }
          if (nowMs >= endMs) {
            return classSum + 60;
          }
          if (nowMs <= startMs) {
            return classSum;
          }
          const elapsedMinutes = Math.floor((nowMs - startMs) / (60 * 1000));
          const boundedElapsed = Math.max(0, Math.min(59, elapsedMinutes));
          return classSum + boundedElapsed;
        },
        0
      );
      return sum + classMinutes;
    }, 0);
    return minutes;
  }, [courses, nowMs]);

  if (!userId) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Courses
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          All courses
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Total class time: {totalClassTimeMinutes} minutes
        </p>
      </header>

      {status.type === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {status.message}
        </div>
      ) : null}

      {isLoadingCourses ? (
        <p className="text-sm text-[var(--muted)]">Loading courses...</p>
      ) : null}

      {!isLoadingCourses && courses.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No courses yet.</p>
      ) : null}

      {!isLoadingCourses && availableCourses.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Available courses
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableCourses.map((course) => (
              <div
                key={course.id}
                className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {course.title}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Tutor:{" "}
                    {course.created_by_name ||
                      course.created_by_email ||
                      "Unknown tutor"}
                  </p>
                  {course.description ? (
                    <p className="text-xs text-[var(--muted)]">
                      {course.description}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {course.is_completed ? (
                    <p className="text-xs text-[var(--muted)]">
                      {formatCompletedDate(course.completed_start_date)} to{" "}
                      {formatCompletedDate(course.completed_end_date)} ·{" "}
                      {course.completed_class_count ?? 0} classes
                    </p>
                  ) : course.course_classes?.length ? (
                    <ul className="space-y-1 text-xs text-[var(--muted)]">
                      {sortClassesByStart(course.course_classes).map((courseClass) => {
                        const { start, end } = getClassTimes(
                          courseClass.starts_at
                        );
                        const tone = getClassTimeStyle(start, end);
                        return (
                          <li key={courseClass.id} className={tone}>
                            {courseClass.title} · {formatClassSchedule(start, end)}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">No classes yet.</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {course.enrollment_status === "enrolled" ? (
                    <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Enrolled
                    </span>
                  ) : course.enrollment_status === "pending" ? (
                    <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700">
                      Pending approval
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedCourse(course)}
                      className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                    >
                      {course.enrollment_status === "rejected"
                        ? "Request again"
                        : "Enroll"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoadingCourses && upcomingCourses.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Upcoming courses
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {upcomingCourses.map((course) => (
              <div
                key={course.id}
                className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {course.title}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Tutor:{" "}
                    {course.created_by_name ||
                      course.created_by_email ||
                      "Unknown tutor"}
                  </p>
                  {course.description ? (
                    <p className="text-xs text-[var(--muted)]">
                      {course.description}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-[var(--muted)]">No classes yet.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {course.enrollment_status === "enrolled" ? (
                    <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Enrolled
                    </span>
                  ) : course.enrollment_status === "pending" ? (
                    <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700">
                      Pending approval
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoadingCourses && completedCourses.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Completed courses
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {completedCourses.map((course) => (
              <div
                key={course.id}
                className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {course.title}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Tutor:{" "}
                    {course.created_by_name ||
                      course.created_by_email ||
                      "Unknown tutor"}
                  </p>
                  {course.description ? (
                    <p className="text-xs text-[var(--muted)]">
                      {course.description}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {course.is_completed ? (
                    <p className="text-xs text-[var(--muted)]">
                      {formatCompletedDate(course.completed_start_date)} to{" "}
                      {formatCompletedDate(course.completed_end_date)} ·{" "}
                      {course.completed_class_count ?? 0} classes
                    </p>
                  ) : course.course_classes?.length ? (
                    <ul className="space-y-1 text-xs text-[var(--muted)]">
                      {sortClassesByStart(course.course_classes).map((courseClass) => {
                        const { start, end } = getClassTimes(
                          courseClass.starts_at
                        );
                        const tone = getClassTimeStyle(start, end);
                        return (
                          <li key={courseClass.id} className={tone}>
                            {courseClass.title} · {formatClassSchedule(start, end)}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">No classes yet.</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {course.enrollment_status === "enrolled" ? (
                    <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Enrolled
                    </span>
                  ) : course.enrollment_status === "pending" ? (
                    <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700">
                      Pending approval
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedCourse ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Confirm enrollment
              </p>
              <h3 className="text-lg font-semibold text-[var(--foreground)]">
                {selectedCourse.title}
              </h3>
              <p className="text-xs text-[var(--muted)]">
                Tutor:{" "}
                {selectedCourse.created_by_name ||
                  selectedCourse.created_by_email ||
                  "Unknown tutor"}
              </p>
            </div>

            {selectedCourse.description ? (
              <p className="text-sm text-[var(--muted)]">
                {selectedCourse.description}
              </p>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {selectedCourse.is_completed ? "Course summary" : "Classes"}
              </p>
              {selectedCourse.is_completed ? (
                <p className="text-xs text-[var(--muted)]">
                  Completed course: {formatCompletedDate(selectedCourse.completed_start_date)} to{" "}
                  {formatCompletedDate(selectedCourse.completed_end_date)} ·{" "}
                  {selectedCourse.completed_class_count ?? 0} classes
                </p>
              ) : selectedCourse.course_classes?.length ? (
                <ul className="space-y-1 text-xs text-[var(--muted)]">
                  {sortClassesByStart(selectedCourse.course_classes).map((courseClass) => {
                    const { start, end } = getClassTimes(
                      courseClass.starts_at
                    );
                    const tone = getClassTimeStyle(start, end);
                    return (
                      <li key={courseClass.id} className={tone}>
                        {courseClass.title} · {formatClassSchedule(start, end)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">No classes yet.</p>
              )}
            </div>

            <p className="text-xs text-[var(--muted)]">
              When you enroll, the founder will review your request. You will
              receive an email when it is approved or rejected.
            </p>
            {selectedCourse.donation_link ? (
              <p className="text-xs text-[var(--muted)]">
                You MUST donate via{" "}
                <a
                  href={selectedCourse.donation_link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[var(--foreground)] underline"
                >
                  this link
                </a>{" "}
                and complete{" "}
                <a
                  href="https://forms.gle/tfxiH8zHfCifpBSa9"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[var(--foreground)] underline"
                >
                  this form
                </a>{" "}
                in order for your enrollment to be accepted.
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                You MUST complete{" "}
                <a
                  href="https://forms.gle/tfxiH8zHfCifpBSa9"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[var(--foreground)] underline"
                >
                  this form
                </a>{" "}
                in order for your enrollment to be accepted.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedCourse(null)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                disabled={isEnrolling}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsEnrolling(true);
                  setStatus({ type: "idle", message: "" });
                  const response = await fetch(
                    `/api/courses/${selectedCourse.id}/enroll`,
                    { method: "POST" }
                  );

                  if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as
                      | { error?: string }
                      | null;
                    setStatus({
                      type: "error",
                      message:
                        payload?.error ?? "Unable to submit enrollment request.",
                    });
                    setIsEnrolling(false);
                    return;
                  }

                  setCourses((current) =>
                    current.map((course) =>
                      course.id === selectedCourse.id
                        ? { ...course, enrollment_status: "pending" }
                        : course
                    )
                  );
                  setSelectedCourse(null);
                  setIsEnrolling(false);
                }}
                disabled={isEnrolling}
                className="rounded-full border border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isEnrolling ? "Submitting..." : "Confirm enroll"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
