"use client";

import { useEffect, useState } from "react";
import { FEEDBACK_WINDOW_DAYS, type FeedbackAnswers, type FeedbackSummary } from "@/lib/courseFeedback";
import { FeedbackAnswersView, FeedbackSummaryView, formatFeedbackDate } from "@/components/CourseFeedbackAnswers";

type TutorFeedbackCourse = {
  courseId: string;
  title: string;
  endedAt: string;
  status: "open" | "closed";
  closesAt: string;
  summary: FeedbackSummary | null;
  answers: FeedbackAnswers[];
};

/**
 * Teaching → My courses: what students said about this tutor's ended courses
 * (COURSE_FEEDBACK.md), without names and only once each form has closed.
 * Renders nothing for a tutor with no ended course.
 */
export default function TutorCourseFeedbackCard() {
  const [courses, setCourses] = useState<TutorFeedbackCourse[]>([]);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/course-feedback/tutor");
        if (!response.ok) return;
        const data = (await response.json()) as { courses?: TutorFeedbackCourse[] };
        setCourses(data.courses ?? []);
      } catch {
        // Shown again the next time the page is opened.
      }
    };
    load();
  }, []);

  if (courses.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--foreground)]">Course feedback</p>
        <p className="text-xs text-[var(--muted)]">
          When a course&apos;s last class ends, its students can fill in an optional form for{" "}
          {FEEDBACK_WINDOW_DAYS} days. Once the form closes, their answers appear here without their names.
        </p>
      </div>
      <ul className="space-y-2">
        {courses.map((course) => {
          const isOpen = openCourseId === course.courseId;
          return (
            <li key={course.courseId} className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3">
              <p className="text-xs font-semibold text-[var(--foreground)]">
                {course.title}
                <span className="font-normal text-[var(--muted)]"> · ended {formatFeedbackDate(course.endedAt)}</span>
              </p>
              {course.status === "open" ? (
                <p className="text-xs text-[var(--muted)]">
                  The form is open until {formatFeedbackDate(course.closesAt)}; the answers appear here then.
                </p>
              ) : (
                <>
                  {course.summary ? <FeedbackSummaryView summary={course.summary} /> : null}
                  {course.answers.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpenCourseId(isOpen ? null : course.courseId)}
                        className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                      >
                        {isOpen ? "Hide answers" : "Show answers"}
                      </button>
                      {isOpen ? (
                        <ul className="space-y-2">
                          {course.answers.map((answers, index) => (
                            <li key={index} className="rounded-lg border border-[var(--border)] px-3 py-2">
                              <FeedbackAnswersView answers={answers} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
