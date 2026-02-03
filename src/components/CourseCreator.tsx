"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { canManageCourses, resolveUserRole, type UserRole } from "@/lib/roles";

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

type CourseClass = {
  id: string;
  title: string;
  starts_at: string;
  created_at: string;
};

type Course = {
  id: string;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  course_classes: CourseClass[];
};

export default function CourseCreator() {
  const [canCreate, setCanCreate] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [classTitle, setClassTitle] = useState<Record<string, string>>({});
  const [classStartsAt, setClassStartsAt] = useState<Record<string, string>>({});
  const [draftClassTitle, setDraftClassTitle] = useState("");
  const [draftClassStartsAt, setDraftClassStartsAt] = useState("");
  const [draftClasses, setDraftClasses] = useState<
    { title: string; startsAt: string }[]
  >([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setRole(null);
        setUserId(null);
        setCanCreate(false);
        return;
      }

      const resolvedRole = resolveUserRole(
        data.user.email,
        data.user.user_metadata?.role ?? null
      );
      setRole(resolvedRole);
      setUserId(data.user.id);
      setCanCreate(canManageCourses(resolvedRole));
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null;
        if (!user) {
          setRole(null);
          setUserId(null);
          setCanCreate(false);
          return;
        }

        const resolvedRole = resolveUserRole(
          user.email ?? null,
          user.user_metadata?.role ?? null
        );
        setRole(resolvedRole);
        setUserId(user.id);
        setCanCreate(canManageCourses(resolvedRole));
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
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

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    if (!title.trim()) {
      setStatus({ type: "error", message: "Please add a title." });
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        classes: draftClasses.map((item) => ({
          title: item.title,
          startsAt: new Date(item.startsAt).toISOString(),
        })),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to create course.",
      });
      setIsSubmitting(false);
      return;
    }

    const payload = (await response.json()) as { course: Course };
    setCourses((current) => [payload.course, ...current]);
    setTitle("");
    setDescription("");
    setDraftClassTitle("");
    setDraftClassStartsAt("");
    setDraftClasses([]);
    setStatus({ type: "success", message: "Course created." });
    setIsSubmitting(false);
  };

  const upcomingCourses = useMemo(() => {
    if (!userId) {
      return [];
    }

    if (role === "founder") {
      return courses;
    }

    return courses.filter((course) => course.created_by === userId);
  }, [courses, role, userId]);

  const onCreateClass = async (
    courseId: string,
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    const titleValue = (classTitle[courseId] ?? "").trim();
    const startsAtValue = classStartsAt[courseId] ?? "";

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
      current.map((course) =>
        course.id === courseId
          ? {
              ...course,
              course_classes: [...(course.course_classes ?? []), payload.class],
            }
          : course
      )
    );
    setClassTitle((current) => ({ ...current, [courseId]: "" }));
    setClassStartsAt((current) => ({ ...current, [courseId]: "" }));
    setStatus({ type: "success", message: "Class added." });
    setPendingCourseId(null);
  };

  const addDraftClass = () => {
    setStatus({ type: "idle", message: "" });

    const titleValue = draftClassTitle.trim();
    const startsAtValue = draftClassStartsAt;

    if (!titleValue) {
      setStatus({ type: "error", message: "Class title is required." });
      return;
    }

    if (!startsAtValue) {
      setStatus({ type: "error", message: "Class date/time is required." });
      return;
    }

    setDraftClasses((current) => [
      ...current,
      { title: titleValue, startsAt: startsAtValue },
    ]);
    setDraftClassTitle("");
    setDraftClassStartsAt("");
  };

  const removeDraftClass = (index: number) => {
    setDraftClasses((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };


  if (!canCreate) {
    return null;
  }

  return (
    <section className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Create
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Create a new course
        </h2>
      </header>

      {status.type !== "idle" ? (
        <div
          className={
            status.type === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
          }
        >
          {status.message}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Intro to Python"
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            required
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Description
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What students will learn, projects, and outcomes."
            rows={4}
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
          />
        </div>
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Classes (Optional)
            </p>
            <p className="text-xs text-[var(--muted)]">
              Add classes now or later.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
            <input
              type="text"
              placeholder="Class title"
              value={draftClassTitle}
              onChange={(event) => setDraftClassTitle(event.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <input
              type="datetime-local"
              value={draftClassStartsAt}
              onChange={(event) => setDraftClassStartsAt(event.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <button
              type="button"
              onClick={addDraftClass}
              className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white"
            >
              Add class
            </button>
          </div>
          {draftClasses.length ? (
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              {draftClasses.map((draftClass, index) => (
                <li
                  key={`${draftClass.title}-${draftClass.startsAt}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <span>
                    {draftClass.title} ·{" "}
                    {new Date(draftClass.startsAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDraftClass(index)}
                    className="text-xs font-semibold text-[var(--foreground)] transition hover:text-red-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Creating..." : "Create course"}
        </button>
      </form>

      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Manage courses
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Add classes with a date and time (local timezone).
          </p>
        </div>

        {isLoadingCourses ? (
          <p className="text-sm text-[var(--muted)]">Loading courses...</p>
        ) : null}

        {!isLoadingCourses && upcomingCourses.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Create your first course to add classes.
          </p>
        ) : null}

        <div className="space-y-3">
          {upcomingCourses.map((course) => (
            <div
              key={course.id}
              className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {course.title}
                </p>
                {course.description ? (
                  <p className="text-xs text-[var(--muted)]">
                    {course.description}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                {course.course_classes?.length ? (
                  <ul className="space-y-1 text-xs text-[var(--muted)]">
                    {course.course_classes.map((courseClass) => (
                      <li key={courseClass.id}>
                        {courseClass.title} ·{" "}
                        {new Date(courseClass.starts_at).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    No classes yet.
                  </p>
                )}
              </div>

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
                  value={classStartsAt[course.id] ?? ""}
                  onChange={(event) =>
                    setClassStartsAt((current) => ({
                      ...current,
                      [course.id]: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  required
                />
                <button
                  type="submit"
                  disabled={pendingCourseId === course.id}
                  className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pendingCourseId === course.id ? "Adding..." : "Add class"}
                </button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
