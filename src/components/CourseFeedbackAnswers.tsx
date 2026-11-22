import { anotherCourseLabel, paceLabel, type FeedbackAnswers, type FeedbackSummary } from "@/lib/courseFeedback";

/** Shared pieces for showing post-course feedback (COURSE_FEEDBACK.md). */

export const formatFeedbackDate = (value: string | null | undefined) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const rating = (value: number | null) => (value === null ? null : `${value}/5`);

/** One response's answers, skipping the questions left empty. */
export function FeedbackAnswersView({ answers }: { answers: FeedbackAnswers }) {
  const lines: [string, string | null][] = [
    ["Course", rating(answers.courseRating)],
    ["Tutor", rating(answers.tutorRating)],
    ["Pace", paceLabel(answers.pace)],
    ["Another YanLearn course", anotherCourseLabel(answers.anotherCourse)],
    ["Next course", answers.nextCourse],
  ];
  return (
    <div className="space-y-1 text-xs text-[var(--foreground)]">
      <p>
        {lines
          .filter((line): line is [string, string] => Boolean(line[1]))
          .map(([label, value]) => `${label}: ${value}`)
          .join(" · ") || "No ratings or choices."}
      </p>
      {answers.comments ? (
        <p className="whitespace-pre-wrap break-words text-[var(--muted)]">“{answers.comments}”</p>
      ) : null}
    </div>
  );
}

/** Averages and counts for one course. */
export function FeedbackSummaryView({ summary }: { summary: FeedbackSummary }) {
  if (summary.responses === 0) {
    return (
      <p className="text-xs text-[var(--muted)]">
        No answers{summary.declined ? ` (${summary.declined} chose not to answer)` : ""}.
      </p>
    );
  }
  const parts = [
    `${summary.responses} ${summary.responses === 1 ? "answer" : "answers"}`,
    summary.courseRatingAverage !== null ? `course ${summary.courseRatingAverage}/5` : null,
    summary.tutorRatingAverage !== null ? `tutor ${summary.tutorRatingAverage}/5` : null,
    `pace: ${summary.pace.too_slow} too slow, ${summary.pace.about_right} about right, ${summary.pace.too_fast} too fast`,
    `another course: ${summary.anotherCourse.yes} yes, ${summary.anotherCourse.maybe} maybe, ${summary.anotherCourse.no} no`,
    summary.declined ? `${summary.declined} chose not to answer` : null,
  ].filter(Boolean);
  return <p className="text-xs text-[var(--foreground)]">{parts.join(" · ")}</p>;
}
