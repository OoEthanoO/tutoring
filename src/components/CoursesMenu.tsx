"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type StatusState = {
  type: "idle" | "error";
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
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  course_classes: CourseClass[];
};

export default function CoursesMenu() {
  const [userId, setUserId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserId(session?.user?.id ?? null);
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

  const visibleCourses = useMemo(
    () => courses,
    [courses]
  );

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
          Available courses
        </h2>
      </header>

      {status.type === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {status.message}
        </div>
      ) : null}

      {isLoadingCourses ? (
        <p className="text-sm text-[var(--muted)]">Loading courses...</p>
      ) : null}

      {!isLoadingCourses && visibleCourses.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No courses yet.</p>
      ) : null}

      <div className="space-y-3">
        {visibleCourses.map((course) => (
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
                <p className="text-xs text-[var(--muted)]">No classes yet.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
