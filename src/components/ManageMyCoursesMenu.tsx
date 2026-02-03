"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
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
  description: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  course_classes: CourseClass[];
  course_enrollments: EnrolledStudent[];
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function ManageMyCoursesMenu() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [donationLink, setDonationLink] = useState<string>("");
  const [classTitle, setClassTitle] = useState<Record<string, string>>({});
  const [classStartsAt, setClassStartsAt] = useState<Record<string, string>>({});
  const [classDuration, setClassDuration] = useState<Record<string, string>>({});
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editDuration, setEditDuration] = useState("1");
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setRole(null);
        return;
      }

      const resolvedRole = resolveUserRole(
        data.user.email,
        data.user.user_metadata?.role ?? null
      );
      setRole(resolvedRole);
    };

    load();
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
      setDonationLink("");
      return;
    }

    const loadDonationLink = async () => {
      const response = await fetch("/api/tutor-profile");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { donationLink?: string };
      setDonationLink(data.donationLink ?? "");
    };

    loadDonationLink();
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
    return toLocalDateTimeInputValue(suggested);
  };

  const getSuggestedDuration = (course: Course) => {
    if (!course.course_classes || course.course_classes.length === 0) {
      return "1";
    }

    const sorted = [...course.course_classes].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const value =
      typeof latest.duration_hours === "number" && latest.duration_hours > 0
        ? latest.duration_hours
        : 1;
    return String(value);
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
    const durationValue = Number(
      classDuration[courseId] || (course ? getSuggestedDuration(course) : "1")
    );

    if (!titleValue) {
      setStatus({ type: "error", message: "Class title is required." });
      return;
    }

    if (!startsAtValue) {
      setStatus({ type: "error", message: "Class date/time is required." });
      return;
    }

    setPendingCourseId(courseId);
    const response = await fetch(`/api/courses/${courseId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleValue,
        startsAt: new Date(startsAtValue).toISOString(),
        durationHours: durationValue > 0 ? durationValue : 1,
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
    setClassDuration((current) => ({ ...current, [courseId]: "1" }));
    setStatus({ type: "success", message: "Class added." });
    setPendingCourseId(null);
  };

  const startEditClass = (courseClass: CourseClass) => {
    setEditingClassId(courseClass.id);
    setEditTitle(courseClass.title);
    setEditStartsAt(
      toLocalDateTimeInputValue(new Date(courseClass.starts_at))
    );
    setEditDuration(String(courseClass.duration_hours || 1));
  };

  const cancelEditClass = () => {
    setEditingClassId(null);
    setEditTitle("");
    setEditStartsAt("");
    setEditDuration("1");
  };

  const saveClassEdit = async () => {
    if (!editingClassId) {
      return;
    }

    setPendingClassId(editingClassId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/classes/${editingClassId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim(),
        startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : undefined,
        durationHours: Number(editDuration || "1"),
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

  if (!role || !canManageCourses(role)) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Courses
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Manage my courses
        </h2>
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
        {courses.map((course) => (
          <div
            key={course.id}
            className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {course.title}
                </p>
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

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Classes
              </p>
              {course.course_classes?.length ? (
                <ul className="space-y-2 text-xs text-[var(--muted)]">
                  {sortClassesByStart(course.course_classes).map((courseClass) => (
                    <li key={courseClass.id} className="space-y-2">
                      {editingClassId === courseClass.id ? (
                        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.7fr_auto]">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                          <input
                            type="datetime-local"
                            value={editStartsAt}
                            onChange={(event) =>
                              setEditStartsAt(event.target.value)
                            }
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={editDuration}
                            onChange={(event) =>
                              setEditDuration(event.target.value)
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
                            {courseClass.duration_hours} hrs
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

            <form
              className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.7fr_auto]"
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
                value={classStartsAt[course.id] || getSuggestedStartValue(course) || ""}
                onChange={(event) =>
                  setClassStartsAt((current) => ({
                    ...current,
                    [course.id]: event.target.value,
                  }))
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                required
              />
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={classDuration[course.id] || getSuggestedDuration(course) || "1"}
                onChange={(event) =>
                  setClassDuration((current) => ({
                    ...current,
                    [course.id]: event.target.value,
                  }))
                }
                placeholder="Duration (hrs)"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                required
              />
              <button
                type="submit"
                disabled={pendingCourseId === course.id}
                className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-4"
              >
                {pendingCourseId === course.id ? "Adding..." : "Add class"}
              </button>
            </form>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Enrolled students
              </p>
              {course.course_enrollments?.length ? (
                <ul className="space-y-1 text-xs text-[var(--muted)]">
                  {course.course_enrollments.map((student) => (
                    <li key={student.id}>
                      {student.student_name || "Student"} ·{" "}
                      {student.student_email || "No email"}
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
