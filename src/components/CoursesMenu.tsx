"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const getCourseLastClassTime = (course: Course) => {
  if (course.is_completed && course.completed_end_date) {
    const completedAt = new Date(`${course.completed_end_date}T00:00:00`);
    return completedAt.getTime();
  }

  const classStarts = (course.course_classes ?? [])
    .map((item) => new Date(item.starts_at).getTime())
    .filter((value) => Number.isFinite(value));
  if (classStarts.length > 0) {
    return Math.max(...classStarts);
  }

  return Number.NEGATIVE_INFINITY;
};

const sortCoursesByLastClassDesc = (left: Course, right: Course) => {
  const leftLast = getCourseLastClassTime(left);
  const rightLast = getCourseLastClassTime(right);
  if (leftLast !== rightLast) {
    return rightLast - leftLast;
  }

  const leftCreated = new Date(left.created_at).getTime();
  const rightCreated = new Date(right.created_at).getTime();
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    return rightCreated - leftCreated;
  }

  return left.title.localeCompare(right.title);
};

const formatDateOnlyFromTimestamp = (value: number) => {
  if (!Number.isFinite(value)) {
    return "Unknown";
  }
  return new Date(value).toLocaleDateString();
};

const getCompletedCourseSummary = (course: Course) => {
  if (course.is_completed) {
    return {
      startLabel: formatCompletedDate(course.completed_start_date),
      endLabel: formatCompletedDate(course.completed_end_date),
      classCount: course.completed_class_count ?? 0,
    };
  }

  const classStarts = (course.course_classes ?? [])
    .map((item) => new Date(item.starts_at).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const startLabel =
    classStarts.length > 0
      ? formatDateOnlyFromTimestamp(classStarts[0])
      : "Unknown";
  const endLabel =
    classStarts.length > 0
      ? formatDateOnlyFromTimestamp(classStarts[classStarts.length - 1])
      : "Unknown";

  return {
    startLabel,
    endLabel,
    classCount: classStarts.length,
  };
};

export default function CoursesMenu() {
  const [userId, setUserId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [hasOpenedDonationLink, setHasOpenedDonationLink] = useState(false);
  const [hasOpenedApplicationLink, setHasOpenedApplicationLink] = useState(false);
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

  const hasGrayClass = useCallback(
    (course: Course) =>
      (course.course_classes ?? []).some((item) => {
        const startsAt = new Date(item.starts_at).getTime();
        return Number.isFinite(startsAt) && startsAt > nowMs;
      }),
    [nowMs]
  );

  const hasYellowClass = useCallback(
    (course: Course) =>
      (course.course_classes ?? []).some((item) => {
        const startsAt = new Date(item.starts_at).getTime();
        if (!Number.isFinite(startsAt)) {
          return false;
        }
        const endsAt = startsAt + 60 * 60 * 1000;
        return nowMs >= startsAt && nowMs <= endsAt;
      }),
    [nowMs]
  );

  const isAvailableSectionCourse = useCallback(
    (course: Course) =>
      !course.is_completed && (hasGrayClass(course) || hasYellowClass(course)),
    [hasGrayClass, hasYellowClass]
  );

  const availableCourses = useMemo(
    () =>
      courses
        .filter((course) => isAvailableSectionCourse(course))
        .sort(sortCoursesByLastClassDesc),
    [courses, isAvailableSectionCourse]
  );

  const upcomingCourses = useMemo(
    () =>
      courses
        .filter(
          (course) =>
            !isAvailableSectionCourse(course) &&
            !course.is_completed &&
            (!course.course_classes || course.course_classes.length === 0)
        )
        .sort(sortCoursesByLastClassDesc),
    [courses, isAvailableSectionCourse]
  );

  const completedCourses = useMemo(
    () =>
      courses
        .filter(
          (course) =>
            !isAvailableSectionCourse(course) &&
            (course.is_completed ||
              (course.course_classes && course.course_classes.length > 0))
        )
        .sort(sortCoursesByLastClassDesc),
    [courses, isAvailableSectionCourse]
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

  const requiresDonationLink = Boolean(selectedCourse?.donation_link);
  const hasClickedBothLinks = hasOpenedDonationLink && hasOpenedApplicationLink;
  const canConfirmEnrollment = selectedCourse
    ? requiresDonationLink
      ? hasClickedBothLinks
      : hasOpenedApplicationLink
    : false;
  const isConfirmEnrollmentDisabled = isEnrolling || !canConfirmEnrollment;

  const openEnrollmentModal = (course: Course) => {
    setHasOpenedDonationLink(false);
    setHasOpenedApplicationLink(false);
    setSelectedCourse(course);
  };

  const isGuest = !userId;

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
                  {isGuest ? null : course.enrollment_status === "enrolled" ? (
                    <span className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Enrolled
                    </span>
                  ) : course.enrollment_status === "pending" ? (
                    <span className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700">
                      Pending approval
                    </span>
                  ) : hasGrayClass(course) ? (
                    <button
                      type="button"
                      onClick={() => openEnrollmentModal(course)}
                      className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                    >
                      {course.enrollment_status === "rejected"
                        ? "Request again"
                        : "Enroll"}
                    </button>
                  ) : null}
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
            {completedCourses.map((course) => {
              const summary = getCompletedCourseSummary(course);
              return (
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
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-[var(--muted)]">
                      {summary.startLabel} to {summary.endLabel} ·{" "}
                      {summary.classCount} classes
                    </p>
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
              );
            })}
          </div>
        </div>
      ) : null}

      {!isGuest && selectedCourse ? (
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
                  onClick={() => setHasOpenedDonationLink(true)}
                  className={`font-semibold underline ${
                    hasOpenedDonationLink ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  this link
                </a>{" "}
                and complete{" "}
                <a
                  href="https://forms.gle/tfxiH8zHfCifpBSa9"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setHasOpenedApplicationLink(true)}
                  className={`font-semibold underline ${
                    hasOpenedApplicationLink ? "text-emerald-500" : "text-red-500"
                  }`}
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
                  onClick={() => setHasOpenedApplicationLink(true)}
                  className={`font-semibold underline ${
                    hasOpenedApplicationLink ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  this form
                </a>{" "}
                in order for your enrollment to be accepted.
              </p>
            )}
            {requiresDonationLink ? (
              <p className="text-xs font-semibold text-[var(--muted)]">
                To finish enrollment, you must click on both links above.
              </p>
            ) : (
              <p className="text-xs font-semibold text-[var(--muted)]">
                To finish enrollment, you must click on the required link above.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedCourse(null);
                  setHasOpenedDonationLink(false);
                  setHasOpenedApplicationLink(false);
                }}
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
                  setHasOpenedDonationLink(false);
                  setHasOpenedApplicationLink(false);
                  setIsEnrolling(false);
                }}
                disabled={isConfirmEnrollmentDisabled}
                title={
                  isConfirmEnrollmentDisabled
                    ? "Click all required links above to enable enrollment."
                    : undefined
                }
                className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  isConfirmEnrollmentDisabled
                    ? "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-800 shadow-inner"
                    : "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)] hover:opacity-90"
                }`}
              >
                {isEnrolling
                  ? "Submitting..."
                  : isConfirmEnrollmentDisabled
                    ? "Confirm enrollment (locked)"
                    : "Confirm enrollment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
