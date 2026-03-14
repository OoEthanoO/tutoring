"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientUser, getCurrentUser, onAuthChange } from "@/lib/authClient";
import { setHasUnsavedData } from "@/lib/unsavedData";
import { MarkdownText } from "@/lib/parseMarkdown";
import StudentApplicationForm from "./StudentApplicationForm";

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
  max_students?: number | null;
  enrollment_count?: number;
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

const sortCoursesByFirstClassDesc = (left: Course, right: Course) => {
  const getFirstClassTime = (course: Course) => {
    if (course.is_completed && course.completed_start_date) {
      const completedAt = new Date(`${course.completed_start_date}T00:00:00`);
      return completedAt.getTime();
    }

    const classStarts = (course.course_classes ?? [])
      .map((item) => new Date(item.starts_at).getTime())
      .filter((value) => Number.isFinite(value));
    if (classStarts.length > 0) {
      return Math.min(...classStarts);
    }

    return Number.NEGATIVE_INFINITY;
  };

  const leftFirst = getFirstClassTime(left);
  const rightFirst = getFirstClassTime(right);

  if (leftFirst !== rightFirst) {
    return rightFirst - leftFirst; // Latest first
  }

  const leftCreated = new Date(left.created_at).getTime();
  const rightCreated = new Date(right.created_at).getTime();
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }
  }

  return left.title.localeCompare(right.title);
};
const sortCoursesByCreationDateDesc = (left: Course, right: Course) => {
  const leftCreated = new Date(left.created_at).getTime();
  const rightCreated = new Date(right.created_at).getTime();
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }
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
  const [user, setUser] = useState<ClientUser | null>(null);
  const userId = user?.id ?? null;
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

  const modalScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHasUnsavedData("courses-menu", selectedCourse !== null);
    return () => setHasUnsavedData("courses-menu", false);
  }, [selectedCourse]);

  useEffect(() => {
    if (selectedCourse && modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [selectedCourse]);

  useEffect(() => {
    if (selectedCourse) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedCourse]);

  useEffect(() => {
    if (!selectedCourse) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [selectedCourse]);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setUser(user);
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

  const isFullCourse = useCallback((course: Course) => {
    if (typeof course.max_students === "number" && course.max_students > 0) {
      return (course.enrollment_count ?? 0) >= course.max_students;
    }
    return false;
  }, []);

  const isEnrolledInCourse = useCallback((course: Course) => {
    return (
      course.enrollment_status === "enrolled" ||
      course.enrollment_status === "pending" ||
      course.enrollment_status === "approved" ||
      course.enrollment_status === "rejected"
    );
  }, []);

  const availableCourses = useMemo(
    () =>
      courses
        .filter((course) => isAvailableSectionCourse(course))
        .sort((a, b) => {
          const getFirstClassTime = (course: Course) => {
            const allClasses = (course.course_classes ?? [])
              .map((item) => new Date(item.starts_at).getTime())
              .filter((value) => Number.isFinite(value));
            if (allClasses.length > 0) {
              return Math.min(...allClasses);
            }
            return Number.NEGATIVE_INFINITY;
          };

          const aFirst = getFirstClassTime(a);
          const bFirst = getFirstClassTime(b);

          if (aFirst !== bFirst) {
            return bFirst - aFirst;
          }

          return sortCoursesByCreationDateDesc(a, b);
        }),
    [courses, isAvailableSectionCourse, nowMs]
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
        .sort(sortCoursesByCreationDateDesc),
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
        .sort(sortCoursesByFirstClassDesc),
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
  const isGuest = !userId;

  const openEnrollmentModal = (course: Course) => {
    setHasOpenedDonationLink(false);
    setHasOpenedApplicationLink(false);
    setSelectedCourse(course);
  };

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
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
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
            {availableCourses.map((course) => {
              const full = isFullCourse(course);
              return (
                <div
                  key={course.id}
                  onClick={() => openEnrollmentModal(course)}
                  className={`group flex h-[140px] flex-col rounded-xl border border-[var(--border)] p-4 transition-all focus-within:ring-2 focus-within:ring-[var(--foreground)] ${full ? "cursor-pointer hover:border-amber-400" : "cursor-pointer hover:border-[var(--foreground)]"
                    }`}
                >
                  <div className="flex-1 min-h-0 space-y-1">
                    <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {course.title}
                    </p>
                    {course.description ? (
                      <div className="line-clamp-4 overflow-hidden text-xs text-[var(--muted)]">
                        <MarkdownText text={course.description} />
                      </div>
                    ) : (
                      <p className="text-xs italic text-[var(--muted)]">No description provided.</p>
                    )}
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <p className="text-[10px] font-medium text-[var(--muted)] truncate">
                      {course.created_by_name || "Unknown"}
                    </p>
                    <p className="shrink-0 text-[10px] font-medium text-[var(--muted)]">
                      {course.enrollment_count ?? 0}
                      {course.max_students ? `/${course.max_students}` : ""} students
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!isLoadingCourses && upcomingCourses.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Upcoming courses
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {upcomingCourses.map((course) => {
              const full = isFullCourse(course);
              return (
                <div
                  key={course.id}
                  onClick={() => openEnrollmentModal(course)}
                  className={`group flex h-[140px] flex-col rounded-xl border border-[var(--border)] p-4 transition-all focus-within:ring-2 focus-within:ring-[var(--foreground)] ${full ? "cursor-pointer hover:border-amber-400" : "cursor-pointer hover:border-[var(--foreground)]"
                    }`}
                >
                  <div className="flex-1 min-h-0 space-y-1">
                    <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {course.title}
                    </p>
                    {course.description ? (
                      <div className="line-clamp-4 overflow-hidden text-xs text-[var(--muted)]">
                        <MarkdownText text={course.description} />
                      </div>
                    ) : (
                      <p className="text-xs italic text-[var(--muted)]">No description provided.</p>
                    )}
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <p className="text-[10px] font-medium text-[var(--muted)] truncate">
                      {course.created_by_name || "Unknown"}
                    </p>
                    <p className="shrink-0 text-[10px] font-medium text-[var(--muted)]">
                      {course.enrollment_count ?? 0}
                      {course.max_students ? `/${course.max_students}` : ""} students
                    </p>
                  </div>
                </div>
              );
            })}
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
              const { startLabel, endLabel } = getCompletedCourseSummary(course);
              return (
                <div
                  key={course.id}
                  onClick={() => openEnrollmentModal(course)}
                  className="group flex h-[140px] flex-col rounded-xl border border-[var(--border)] p-4 transition-all hover:border-[var(--foreground)] cursor-pointer"
                >
                  <div className="flex-1 min-h-0 space-y-1">
                    <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {course.title}
                    </p>
                    {course.description ? (
                      <div className="line-clamp-4 overflow-hidden text-xs text-[var(--muted)]">
                        <MarkdownText text={course.description} />
                      </div>
                    ) : (
                      <p className="text-xs italic text-[var(--muted)]">No description provided.</p>
                    )}
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <p className="text-[10px] font-medium text-[var(--muted)] truncate">
                      {course.created_by_name || "Unknown"}
                    </p>
                    <p className="shrink-0 text-[10px] font-medium text-[var(--muted)]">
                      {startLabel} - {endLabel} • {getCompletedCourseSummary(course).classCount} classes
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}



      {!isGuest && selectedCourse ? (
        <div
          key={selectedCourse.id}
          style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
          className="fixed inset-0 z-30 grid place-items-center p-4 overflow-y-auto overscroll-contain bg-black/50"
          onClick={() => setSelectedCourse(null)}
        >
          <div
            style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            className="w-full md:w-[50vw] max-h-full flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl overflow-hidden overscroll-contain min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div ref={modalScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Course information
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
                <button
                  onClick={() => setSelectedCourse(null)}
                  className="p-1 rounded-full hover:bg-[var(--border)] transition text-[var(--muted)] hover:text-[var(--foreground)]"
                  aria-label="Close modal"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!selectedCourse.is_completed && !isFullCourse(selectedCourse) && !isEnrolledInCourse(selectedCourse) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
                  <span className="mt-0.5 flex-shrink-0 text-amber-600 text-base leading-none" aria-hidden="true">⚠️</span>
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
                    Before registering, please carefully check the course tutor and course time you select. Each course has a different donation link, and if you select the wrong one, your donation cannot be refunded.
                  </p>
                </div>
              )}

              {selectedCourse.description ? (
                <div className="text-sm text-[var(--muted)]">
                  <MarkdownText text={selectedCourse.description} />
                </div>
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

              {!selectedCourse.is_completed && !isFullCourse(selectedCourse) && !isEnrolledInCourse(selectedCourse) && (
                <p className="text-xs text-[var(--muted)]">
                  When you enroll, the founder will review your request. You will
                  receive an email when it is approved or rejected.
                </p>
              )}
              {!selectedCourse.is_completed && !isFullCourse(selectedCourse) && !isEnrolledInCourse(selectedCourse) && (
                requiresDonationLink ? (
                  <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 shadow-sm">
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-[var(--foreground)]">
                        Donation Required
                      </p>
                      <p className="text-[10px] text-[var(--muted)] leading-relaxed">
                        To finish the enrollment, you must make donation using the provided link and fill out the student application form below.
                      </p>
                    </div>
                    <a
                      href={selectedCourse.donation_link!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setHasOpenedDonationLink(true)}
                      className={`block w-full rounded-full py-2 text-center text-xs font-bold transition active:scale-[0.98] ${hasOpenedDonationLink
                        ? "border border-[var(--foreground)] text-[var(--foreground)] bg-transparent hover:bg-[var(--surface-muted)]"
                        : "bg-[var(--foreground)] text-[var(--surface)] hover:opacity-90"
                        }`}
                    >
                      {hasOpenedDonationLink ? "Donation Link Opened ✓" : "Open Donation Link"}
                    </a>
                    <p className="text-[10px] text-[var(--muted)] leading-relaxed italic">
                      If you have already donated but didn&apos;t click &quot;Submit Enrollment Request&quot;, simply click on
                      the donation link above but do not make a donation again, and then fill out the form below.
                    </p>

                  </div>
                ) : (
                  <p className="text-xs font-semibold text-[var(--muted)]">
                    To finish enrollment, please fill out the application form below.
                  </p>
                )
              )}

              {!selectedCourse.is_completed && (
                <StudentApplicationForm
                  initialGrade={user?.grade}
                  initialSchool={user?.school}
                  initialStudentName={user?.full_name}
                  isSubmitting={isEnrolling}
                  isConfirmDisabled={(requiresDonationLink && !hasOpenedDonationLink) || isFullCourse(selectedCourse) || isEnrolledInCourse(selectedCourse)}
                  isFull={isFullCourse(selectedCourse)}
                  isEnrolled={isEnrolledInCourse(selectedCourse)}
                  enrollmentStatus={selectedCourse.enrollment_status}
                  onCancel={() => {
                    setSelectedCourse(null);
                    setHasOpenedDonationLink(false);
                    setHasOpenedApplicationLink(false);
                  }}
                  onSubmit={async (formData) => {
                    setIsEnrolling(true);
                    setStatus({ type: "idle", message: "" });
                    const response = await fetch(
                      `/api/courses/${selectedCourse!.id}/enroll`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(formData),
                      }
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
                        course.id === selectedCourse!.id
                          ? { ...course, enrollment_status: "pending" }
                          : course
                      )
                    );
                    setSelectedCourse(null);
                    setHasOpenedDonationLink(false);
                    setHasOpenedApplicationLink(false);
                    setIsEnrolling(false);
                  }}
                />
              )}

            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
