"use client";

import { useEffect, useState } from "react";
import { FEEDBACK_WINDOW_DAYS, type FeedbackAnswers, type FeedbackSummary } from "@/lib/courseFeedback";
import { FeedbackAnswersView, FeedbackSummaryView, formatFeedbackDate } from "@/components/CourseFeedbackAnswers";

type ManagedResponse = {
  studentName: string;
  declined: boolean;
  answers: FeedbackAnswers | null;
  savedAt: string;
};

type ManagedCourse = {
  courseId: string;
  title: string;
  tutorName: string | null;
  endedAt: string;
  status: "open" | "closed";
  closesAt: string;
  invitedAt: string | null;
  enrolledCount: number;
  summary: FeedbackSummary;
  responses: ManagedResponse[];
};

/**
 * Admin → Course feedback (management only): every response to the
 * post-course forms, with the student's name (COURSE_FEEDBACK.md).
 */
export default function CourseFeedbackMenu() {
  const [courses, setCourses] = useState<ManagedCourse[] | null>(null);
  const [error, setError] = useState("");
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/course-feedback/manage");
        const data = (await response.json().catch(() => null)) as { courses?: ManagedCourse[]; error?: string } | null;
        if (!response.ok) {
          setError(data?.error ?? "Could not load course feedback.");
          setCourses([]);
          return;
        }
        setCourses(data?.courses ?? []);
      } catch {
        setError("Could not load course feedback.");
        setCourses([]);
      }
    };
    load();
  }, []);

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Course feedback</h2>
        <p className="text-xs text-[var(--muted)]">
          When a course&apos;s last class ends, its students get one email and a form in My enrollments,
          open for {FEEDBACK_WINDOW_DAYS} days. Every question is optional. You see each response with the
          student&apos;s name; the course&apos;s tutors see the answers without names once the form closes.
        </p>
      </div>
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      {courses === null ? <p className="text-xs text-[var(--muted)]">Loading…</p> : null}
      {courses !== null && courses.length === 0 && !error ? (
        <p className="text-xs text-[var(--muted)]">No course has ended in the last 120 days.</p>
      ) : null}
      <ul className="space-y-3">
        {(courses ?? []).map((course) => {
          const isOpen = openCourseId === course.courseId;
          const answered = course.responses.length;
          return (
            <li key={course.courseId} className="space-y-2 rounded-xl border border-[var(--border)] p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--foreground)]">{course.title}</p>
                <p className="text-xs text-[var(--muted)]">
                  {course.tutorName ? `${course.tutorName} · ` : ""}ended {formatFeedbackDate(course.endedAt)} ·{" "}
                  {course.status === "open"
                    ? `form open until ${formatFeedbackDate(course.closesAt)}`
                    : `form closed ${formatFeedbackDate(course.closesAt)}`}
                  {" · "}
                  {answered} of {course.enrolledCount} {course.enrolledCount === 1 ? "student" : "students"} responded
                  {course.invitedAt ? ` · email sent ${formatFeedbackDate(course.invitedAt)}` : " · no email sent"}
                </p>
              </div>
              <FeedbackSummaryView summary={course.summary} />
              {answered > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenCourseId(isOpen ? null : course.courseId)}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  >
                    {isOpen ? "Hide responses" : "Show responses"}
                  </button>
                  {isOpen ? (
                    <ul className="space-y-2">
                      {course.responses.map((response, index) => (
                        <li key={`${response.studentName}-${index}`} className="space-y-1 rounded-lg border border-[var(--border)] px-3 py-2">
                          <p className="text-xs font-semibold text-[var(--foreground)]">
                            {response.studentName}
                            <span className="font-normal text-[var(--muted)]"> · {formatFeedbackDate(response.savedAt)}</span>
                          </p>
                          {response.declined || !response.answers ? (
                            <p className="text-xs text-[var(--muted)]">Chose not to answer.</p>
                          ) : (
                            <FeedbackAnswersView answers={response.answers} />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
