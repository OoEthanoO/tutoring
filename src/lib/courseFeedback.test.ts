import { describe, expect, it } from "vitest";
import {
  FEEDBACK_INVITE_LOOKBACK_MS,
  FEEDBACK_WINDOW_MS,
  anonymousAnswersForTutor,
  courseEndMs,
  feedbackColumns,
  feedbackWindow,
  parseFeedbackSubmission,
  shouldSendFeedbackInvite,
  summarizeFeedback,
  type CourseFeedbackRow,
} from "./courseFeedback";

const HOUR = 60 * 60 * 1000;
const lastStart = Date.parse("2026-11-12T23:00:00.000Z");
const lastEnd = lastStart + HOUR;
const course = {
  deleted_at: null,
  is_completed: false,
  course_classes: [
    { starts_at: "2026-11-05T23:00:00.000Z", duration_hours: 1 },
    { starts_at: "2026-11-12T23:00:00.000Z", duration_hours: 1 },
  ],
};

const row = (overrides: Partial<CourseFeedbackRow>): CourseFeedbackRow => ({
  id: "row", course_id: "course", student_id: "student", course_rating: null, tutor_rating: null,
  pace: null, another_course: null, next_course: null, comments: null, declined_at: null,
  created_at: "2026-11-13T00:00:00.000Z", updated_at: "2026-11-13T00:00:00.000Z", ...overrides,
});

describe("the feedback window", () => {
  it("ends with the last class, whatever order the classes come in", () => {
    expect(courseEndMs([...course.course_classes].reverse())).toBe(lastEnd);
    expect(courseEndMs([])).toBeNull();
    expect(courseEndMs([{ starts_at: "not a date" }])).toBeNull();
  });

  it("opens when the last class ends and closes 30 days later", () => {
    expect(feedbackWindow(course, lastEnd - 1)).toEqual({ status: "running", endsAtMs: lastEnd });
    expect(feedbackWindow(course, lastEnd)).toEqual({
      status: "open", endedAtMs: lastEnd, closesAtMs: lastEnd + FEEDBACK_WINDOW_MS,
    });
    expect(feedbackWindow(course, lastEnd + FEEDBACK_WINDOW_MS - 1).status).toBe("open");
    expect(feedbackWindow(course, lastEnd + FEEDBACK_WINDOW_MS)).toEqual({
      status: "closed", endedAtMs: lastEnd, closedAtMs: lastEnd + FEEDBACK_WINDOW_MS,
    });
  });

  it("never opens for deleted, imported or unscheduled courses", () => {
    expect(feedbackWindow({ ...course, deleted_at: "2026-11-13T00:00:00Z" }, lastEnd + HOUR).status).toBe("no_classes");
    expect(feedbackWindow({ ...course, is_completed: true }, lastEnd + HOUR).status).toBe("no_classes");
    expect(feedbackWindow({ course_classes: [] }, lastEnd + HOUR).status).toBe("no_classes");
  });
});

describe("the invitation email", () => {
  it("goes once, soon after the last class", () => {
    expect(shouldSendFeedbackInvite(course, lastEnd - 1)).toBe(false);
    expect(shouldSendFeedbackInvite(course, lastEnd + HOUR)).toBe(true);
    expect(shouldSendFeedbackInvite({ ...course, feedback_invited_at: "2026-11-13T00:05:00Z" }, lastEnd + HOUR)).toBe(false);
  });

  it("is never sent for a course that ended long before", () => {
    expect(shouldSendFeedbackInvite(course, lastEnd + FEEDBACK_INVITE_LOOKBACK_MS)).toBe(true);
    expect(shouldSendFeedbackInvite(course, lastEnd + FEEDBACK_INVITE_LOOKBACK_MS + 1)).toBe(false);
  });
});

describe("reading a submission", () => {
  it("keeps the answers given and leaves the rest empty", () => {
    expect(parseFeedbackSubmission({ courseRating: 5, pace: "about_right", comments: "  Great class!\r\n " })).toEqual({
      ok: true, declined: false,
      answers: {
        courseRating: 5, tutorRating: null, pace: "about_right", anotherCourse: null,
        nextCourse: null, comments: "Great class!",
      },
    });
  });

  it("accepts No thanks on its own", () => {
    expect(parseFeedbackSubmission({ declined: true, courseRating: 9 })).toEqual({ ok: true, declined: true });
  });

  it.each([
    [{}, "Answer at least one question"],
    [{ comments: "   " }, "Answer at least one question"],
    [{ courseRating: 6 }, "1 to 5"],
    [{ tutorRating: 2.5 }, "1 to 5"],
    [{ pace: "glacial" }, "choices"],
    [{ anotherCourse: true }, "choices"],
    [{ nextCourse: "x".repeat(201) }, "200 characters"],
    [{ comments: "x".repeat(2001) }, "2000 characters"],
    [null, "Answer at least one question"],
  ])("refuses %j", (body, message) => {
    const parsed = parseFeedbackSubmission(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain(message);
  });

  it("clears every answer when the student changes to No thanks", () => {
    expect(feedbackColumns({ ok: true, declined: true }, "now")).toEqual({
      course_rating: null, tutor_rating: null, pace: null, another_course: null,
      next_course: null, comments: null, declined_at: "now", updated_at: "now",
    });
  });
});

describe("what people see", () => {
  const rows = [
    row({ id: "a", course_rating: 5, tutor_rating: 4, pace: "about_right", another_course: "yes", comments: "Loved it" }),
    row({ id: "b", course_rating: 4, pace: "too_fast", another_course: "maybe" }),
    row({ id: "c", declined_at: "2026-11-14T00:00:00Z" }),
  ];

  it("summarizes the answers and counts No thanks apart", () => {
    expect(summarizeFeedback(rows)).toEqual({
      responses: 2, declined: 1,
      courseRatingAverage: 4.5, courseRatingCount: 2,
      tutorRatingAverage: 4, tutorRatingCount: 1,
      pace: { too_slow: 0, about_right: 1, too_fast: 1 },
      anotherCourse: { yes: 1, maybe: 1, no: 0 },
    });
    expect(summarizeFeedback([]).courseRatingAverage).toBeNull();
  });

  it("shows tutors nothing until the form closes, then the answers alone", () => {
    const open = feedbackWindow(course, lastEnd + HOUR);
    const closed = feedbackWindow(course, lastEnd + FEEDBACK_WINDOW_MS);
    expect(anonymousAnswersForTutor(rows, open)).toEqual([]);
    const seen = anonymousAnswersForTutor(rows, closed);
    expect(seen).toHaveLength(2);
    for (const answers of seen) {
      expect(Object.keys(answers).sort()).toEqual(
        ["anotherCourse", "comments", "courseRating", "nextCourse", "pace", "tutorRating"]
      );
    }
    // The order depends on neither when the answers came nor their order in the table.
    expect(anonymousAnswersForTutor([...rows].reverse(), closed)).toEqual(seen);
  });
});
