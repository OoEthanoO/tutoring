"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole, type UserRole } from "@/lib/roles";

type EnrolledStudent = {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_email?: string | null;
  created_at: string;
};

type CourseClass = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
  created_at: string;
};

type Course = {
  id: string;
  title: string;
  short_name?: string | null;
  description: string | null;
  is_completed?: boolean;
  completed_start_date?: string | null;
  completed_end_date?: string | null;
  completed_class_count?: number | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  course_classes: CourseClass[];
  course_enrollments: EnrolledStudent[];
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

const hasGrayClass = (course: Course, nowMs: number) =>
  (course.course_classes ?? []).some((item) => {
    const startsAt = new Date(item.starts_at).getTime();
    return Number.isFinite(startsAt) && startsAt > nowMs;
  });

const hasYellowClass = (course: Course, nowMs: number) =>
  (course.course_classes ?? []).some((item) => {
    const startsAt = new Date(item.starts_at).getTime();
    if (!Number.isFinite(startsAt)) {
      return false;
    }
    const endsAt = startsAt + 60 * 60 * 1000;
    return nowMs >= startsAt && nowMs <= endsAt;
  });

const getCourseSectionRank = (course: Course, nowMs: number) => {
  const isAvailable =
    !course.is_completed &&
    (hasGrayClass(course, nowMs) || hasYellowClass(course, nowMs));
  if (isAvailable) {
    return 0;
  }

  const isUpcoming =
    !course.is_completed &&
    (!course.course_classes || course.course_classes.length === 0);
  if (isUpcoming) {
    return 1;
  }

  return 2;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

type TutorOption = {
  id: string;
  name: string;
  email: string;
};

const snapDateTimeLocalToFiveMinutes = (value: string) => {
  if (!value) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const snapped = new Date(parsed.getTime());
  snapped.setSeconds(0, 0);
  const minutes = snapped.getMinutes();
  const remainder = minutes % 5;
  if (remainder !== 0) {
    snapped.setMinutes(minutes + (5 - remainder));
  }
  const year = snapped.getFullYear();
  const month = String(snapped.getMonth() + 1).padStart(2, "0");
  const day = String(snapped.getDate()).padStart(2, "0");
  const hours = String(snapped.getHours()).padStart(2, "0");
  const mins = String(snapped.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${mins}`;
};

const isFiveMinuteLocal = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getMinutes() % 5 === 0;
};

export default function ManageMyCoursesMenu() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [donationLink, setDonationLink] = useState<string>("");
  const [donationRaised, setDonationRaised] = useState<number | null>(null);
  const [tutorOptions, setTutorOptions] = useState<TutorOption[]>([]);
  const [classTitle, setClassTitle] = useState<Record<string, string>>({});
  const [classStartsAt, setClassStartsAt] = useState<Record<string, string>>({});
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editCourseTitle, setEditCourseTitle] = useState("");
  const [editCourseShortName, setEditCourseShortName] = useState("");
  const [editCourseDescription, setEditCourseDescription] = useState("");
  const [editCourseTutorId, setEditCourseTutorId] = useState<string>("");
  const [pendingCourseEditId, setPendingCourseEditId] = useState<string | null>(
    null
  );
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingEnrollmentDeleteId, setPendingEnrollmentDeleteId] = useState<
    string | null
  >(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setRole(null);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setRole(resolvedRole);
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
    if (!role || !canManageCourses(role)) {
      return;
    }

    const fetchCourses = async () => {
      setIsLoading(true);
      setStatus({ type: "idle", message: "" });

      const response = await fetch("/api/my-courses");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to load courses.",
        });
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as { courses: Course[] };
      setCourses(data.courses ?? []);
      setIsLoading(false);
    };

    fetchCourses();
  }, [role]);

  useEffect(() => {
    if (role !== "tutor") {
      return;
    }

    const loadDonationLink = async () => {
      const response = await fetch("/api/tutor-profile");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        donationLink?: string;
        donationProgress?: {
          raised?: number | null;
        };
      };
      setDonationLink(data.donationLink ?? "");
      setDonationRaised(
        typeof data.donationProgress?.raised === "number"
          ? data.donationProgress.raised
          : null
      );
    };

    loadDonationLink();
  }, [role]);

  useEffect(() => {
    if (role !== "founder") {
      return;
    }

    const loadTutors = async () => {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        users?: { id: string; fullName?: string; email?: string | null; role?: string }[];
      };
      const options =
        data.users
          ?.filter((user) => user.role === "tutor" || user.role === "founder")
          .map((user) => ({
            id: user.id,
            name: user.fullName || user.email || "Unknown",
            email: user.email ?? "",
          })) ?? [];
      setTutorOptions(options);
    };

    loadTutors();
  }, [role]);

  const toLocalDateTimeInputValue = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const sortClassesByStart = (classes: CourseClass[]) =>
    [...classes].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

  const getSuggestedStartValue = (course: Course) => {
    if (!course.course_classes || course.course_classes.length < 2) {
      return "";
    }

    const sorted = [...course.course_classes].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    const gap =
      new Date(latest.starts_at).getTime() -
      new Date(previous.starts_at).getTime();
    if (!Number.isFinite(gap) || gap <= 0) {
      return "";
    }

    const suggested = new Date(new Date(latest.starts_at).getTime() + gap);
    return snapDateTimeLocalToFiveMinutes(
      toLocalDateTimeInputValue(suggested)
    );
  };

  const onCreateClass = async (
    courseId: string,
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    const titleValue = (classTitle[courseId] ?? "").trim();
    const course = courses.find((item) => item.id === courseId);
    const startsAtValue =
      classStartsAt[courseId] || (course ? getSuggestedStartValue(course) : "");

    if (!titleValue) {
      setStatus({ type: "error", message: "Class title is required." });
      return;
    }

    if (!startsAtValue) {
      setStatus({ type: "error", message: "Class date/time is required." });
      return;
    }
    if (!isFiveMinuteLocal(startsAtValue)) {
      setStatus({
        type: "error",
        message:
          "Class date/time must be on a 5-minute mark (for example 12:00, 12:05, 12:10).",
      });
      return;
    }

    setPendingCourseId(courseId);
    const response = await fetch(`/api/courses/${courseId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleValue,
        startsAt: new Date(startsAtValue).toISOString(),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to create class.",
      });
      setPendingCourseId(null);
      return;
    }

    const payload = (await response.json()) as { class: CourseClass };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === courseId
          ? {
              ...courseItem,
              course_classes: [...(courseItem.course_classes ?? []), payload.class],
            }
          : courseItem
      )
    );

    setClassTitle((current) => ({ ...current, [courseId]: "" }));
    setClassStartsAt((current) => ({ ...current, [courseId]: "" }));
    setStatus({ type: "success", message: "Class added." });
    setPendingCourseId(null);
  };

  const startEditClass = (courseClass: CourseClass) => {
    setEditingClassId(courseClass.id);
    setEditTitle(courseClass.title);
    setEditStartsAt(
      toLocalDateTimeInputValue(new Date(courseClass.starts_at))
    );
  };

  const cancelEditClass = () => {
    setEditingClassId(null);
    setEditTitle("");
    setEditStartsAt("");
  };

  const saveClassEdit = async () => {
    if (!editingClassId) {
      return;
    }

    setPendingClassId(editingClassId);
    setStatus({ type: "idle", message: "" });

    if (editStartsAt && !isFiveMinuteLocal(editStartsAt)) {
      setStatus({
        type: "error",
        message:
          "Class date/time must be on a 5-minute mark (for example 12:00, 12:05, 12:10).",
      });
      setPendingClassId(null);
      return;
    }

    const response = await fetch(`/api/classes/${editingClassId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim(),
        startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to update class.",
      });
      setPendingClassId(null);
      return;
    }

    const payload = (await response.json()) as { class: CourseClass };
    setCourses((current) =>
      current.map((courseItem) => ({
        ...courseItem,
        course_classes: (courseItem.course_classes ?? []).map((courseClass) =>
          courseClass.id === payload.class.id ? payload.class : courseClass
        ),
      }))
    );
    setStatus({ type: "success", message: "Class updated." });
    setPendingClassId(null);
    cancelEditClass();
  };

  const deleteCourse = async (course: Course) => {
    if (role !== "founder") {
      return;
    }

    const name = course.title || "this course";
    const firstConfirm = window.confirm(
      `Are you sure you want to delete "${name}"? This cannot be undone.`
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(
      `Please confirm again to permanently delete "${name}".`
    );
    if (!secondConfirm) {
      return;
    }

    setPendingDeleteId(course.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: course.id }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to delete course.",
      });
      setPendingDeleteId(null);
      return;
    }

    setCourses((current) =>
      current.filter((courseItem) => courseItem.id !== course.id)
    );
    setStatus({ type: "success", message: "Course deleted." });
    setPendingDeleteId(null);
  };

  const startEditCourse = (course: Course) => {
    setEditingCourseId(course.id);
    setEditCourseTitle(course.title ?? "");
    setEditCourseShortName(course.short_name ?? "");
    setEditCourseDescription(course.description ?? "");
    setEditCourseTutorId(course.created_by ?? "");
  };

  const cancelEditCourse = () => {
    setEditingCourseId(null);
    setEditCourseTitle("");
    setEditCourseShortName("");
    setEditCourseDescription("");
    setEditCourseTutorId("");
  };

  const saveCourseEdit = async (courseId: string) => {
    const titleValue = editCourseTitle.trim();

    if (!titleValue) {
      setStatus({ type: "error", message: "Course title is required." });
      return;
    }

    if (role === "founder" && !editCourseTutorId) {
      setStatus({ type: "error", message: "Please select a tutor." });
      return;
    }

    setPendingCourseEditId(courseId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId,
        title: titleValue,
        shortName: role === "founder" ? editCourseShortName.trim() : undefined,
        description: editCourseDescription.trim(),
        createdBy: role === "founder" ? editCourseTutorId : undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to update course.",
      });
      setPendingCourseEditId(null);
      return;
    }

    const payload = (await response.json()) as { course: Course };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === payload.course.id
          ? { ...courseItem, ...payload.course }
          : courseItem
      )
    );
    setStatus({ type: "success", message: "Course updated." });
    setPendingCourseEditId(null);
    cancelEditCourse();
  };

  const removeEnrolledStudent = async (
    courseId: string,
    student: EnrolledStudent
  ) => {
    if (role !== "founder") {
      return;
    }

    const studentLabel = student.student_name || student.student_email || "student";
    const firstConfirm = window.confirm(
      `Remove ${studentLabel} from this course?`
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(
      `Please confirm again to remove ${studentLabel} from this course.`
    );
    if (!secondConfirm) {
      return;
    }

    setPendingEnrollmentDeleteId(student.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/course-enrollments/${student.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to remove enrolled student.",
      });
      setPendingEnrollmentDeleteId(null);
      return;
    }

    setCourses((current) =>
      current.map((course) =>
        course.id === courseId
          ? {
              ...course,
              course_enrollments: (course.course_enrollments ?? []).filter(
                (enrollment) => enrollment.id !== student.id
              ),
            }
          : course
      )
    );
    setStatus({
      type: "success",
      message: `Removed ${studentLabel} from the course.`,
    });
    setPendingEnrollmentDeleteId(null);
  };

  const orderedCourses = useMemo(
    () =>
      [...courses].sort((left, right) => {
        const leftRank = getCourseSectionRank(left, nowMs);
        const rightRank = getCourseSectionRank(right, nowMs);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return sortCoursesByLastClassDesc(left, right);
      }),
    [courses, nowMs]
  );

  if (!role || !canManageCourses(role)) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Courses
        </p>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Manage my courses
          </h2>
          {role === "tutor" &&
          donationLink &&
          donationRaised !== null ? (
            <p className="text-sm font-semibold text-[var(--foreground)]">
              ${donationRaised.toLocaleString()} raised
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          {role === "tutor" && donationLink ? (
            <a
              href={donationLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[var(--foreground)] underline"
            >
              Your donation link
            </a>
          ) : null}
          <a
            href="https://forms.gle/WXrRhDtAv2CH5Chx6"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-[var(--foreground)] underline"
          >
            Tutor Log Form
          </a>
        </div>
      </header>

      {status.type === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {status.message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading courses...</p>
      ) : null}

      {!isLoading && courses.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No courses available yet.
        </p>
      ) : null}

      <div className="space-y-3">
        {orderedCourses.map((course) => (
          <div
            key={course.id}
            className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                {editingCourseId === course.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editCourseTitle}
                      onChange={(event) =>
                        setEditCourseTitle(event.target.value)
                      }
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    />
                    <textarea
                      value={editCourseDescription}
                      onChange={(event) =>
                        setEditCourseDescription(event.target.value)
                      }
                      rows={3}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    />
                    {role === "founder" ? (
                      <>
                        <input
                          type="text"
                          value={editCourseShortName}
                          onChange={(event) =>
                            setEditCourseShortName(event.target.value)
                          }
                          placeholder="Short name (optional)"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        />
                        <select
                          value={editCourseTutorId}
                          onChange={(event) =>
                            setEditCourseTutorId(event.target.value)
                          }
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        >
                          <option value="">Select tutor</option>
                          {tutorOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} {option.email ? `(${option.email})` : ""}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {course.title}
                    </p>
                    {role === "founder" && course.short_name ? (
                      <p className="text-xs text-[var(--muted)]">
                        Short name: {course.short_name}
                      </p>
                    ) : null}
                    {course.description ? (
                      <p className="text-xs text-[var(--muted)]">
                        {course.description}
                      </p>
                    ) : null}
                    {role === "founder" ? (
                      <p className="text-xs text-[var(--muted)]">
                        Tutor:{" "}
                        {course.created_by_name ||
                          course.created_by_email ||
                          "Unknown tutor"}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editingCourseId === course.id ? (
                  <>
                    <button
                      type="button"
                      disabled={pendingCourseEditId === course.id}
                      onClick={() => saveCourseEdit(course.id)}
                      className="rounded-full border border-[var(--foreground)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {pendingCourseEditId === course.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditCourse}
                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEditCourse(course)}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  >
                    Edit
                  </button>
                )}
                {role === "founder" ? (
                  <button
                    type="button"
                    disabled={pendingDeleteId === course.id}
                    onClick={() => deleteCourse(course)}
                    className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pendingDeleteId === course.id ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {course.is_completed ? "Course summary" : "Classes"}
              </p>
              {course.is_completed ? (
                <p className="text-xs text-[var(--muted)]">
                  Completed course: {formatCompletedDate(course.completed_start_date)} to{" "}
                  {formatCompletedDate(course.completed_end_date)} ·{" "}
                  {course.completed_class_count ?? 0} classes
                </p>
              ) : course.course_classes?.length ? (
                <ul className="space-y-2 text-xs text-[var(--muted)]">
                  {sortClassesByStart(course.course_classes).map((courseClass) => (
                    <li key={courseClass.id} className="space-y-2">
                      {editingClassId === courseClass.id ? (
                        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                          <input
                            type="datetime-local"
                            step={300}
                            value={editStartsAt}
                            onChange={(event) =>
                              setEditStartsAt(event.target.value)
                            }
                            onBlur={(event) =>
                              setEditStartsAt(
                                snapDateTimeLocalToFiveMinutes(
                                  event.target.value
                                )
                              )
                            }
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={pendingClassId === courseClass.id}
                              onClick={saveClassEdit}
                              className="rounded-full border border-[var(--foreground)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {pendingClassId === courseClass.id
                                ? "Saving..."
                                : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditClass}
                              className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {courseClass.title} ·{" "}
                            {new Date(courseClass.starts_at).toLocaleString()} ·{" "}
                            1 hr
                          </span>
                          <button
                            type="button"
                            onClick={() => startEditClass(courseClass)}
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">No classes yet.</p>
              )}
            </div>

            {course.is_completed ? null : (
              <form
                className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]"
                onSubmit={(event) => onCreateClass(course.id, event)}
              >
                <input
                  type="text"
                  placeholder="Class title"
                  value={classTitle[course.id] ?? ""}
                  onChange={(event) =>
                    setClassTitle((current) => ({
                      ...current,
                      [course.id]: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  required
                />
                <input
                  type="datetime-local"
                  step={300}
                  value={
                    classStartsAt[course.id] || getSuggestedStartValue(course) || ""
                  }
                  onChange={(event) =>
                    setClassStartsAt((current) => ({
                      ...current,
                      [course.id]: event.target.value,
                    }))
                  }
                  onBlur={(event) =>
                    setClassStartsAt((current) => ({
                      ...current,
                      [course.id]: snapDateTimeLocalToFiveMinutes(
                        event.target.value
                      ),
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  required
                />
                <p className="text-[0.6rem] text-[var(--muted)] sm:col-span-4">
                  Class times must be on a 5-minute mark (e.g. 12:00, 12:05,
                  12:10).
                </p>
                <button
                  type="submit"
                  disabled={pendingCourseId === course.id}
                  className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-4"
                >
                  {pendingCourseId === course.id ? "Adding..." : "Add class"}
                </button>
              </form>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Enrolled students
              </p>
              {course.course_enrollments?.length ? (
                <ul className="space-y-1 text-xs text-[var(--muted)]">
                  {course.course_enrollments.map((student, index) => (
                    <li
                      key={
                        student.id ||
                        student.student_email ||
                        `${student.student_name ?? "student"}-${index}`
                      }
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {student.student_name || "Student"} ·{" "}
                        {student.student_email || "No email"}
                      </span>
                      {role === "founder" ? (
                        <button
                          type="button"
                          disabled={pendingEnrollmentDeleteId === student.id}
                          onClick={() =>
                            removeEnrolledStudent(course.id, student)
                          }
                          className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {pendingEnrollmentDeleteId === student.id
                            ? "Removing..."
                            : "Remove"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  No enrolled students yet.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
