import { classEndMs } from "@/lib/classTiming";

/**
 * Optional post-course feedback (COURSE_FEEDBACK.md). Pure rules, shared by
 * the API routes, the minute cron and the pages, and unit tested.
 *
 * - The form opens when a course's last class ends and closes
 *   FEEDBACK_WINDOW_DAYS later. Until it closes a student can change or
 *   withdraw their answers.
 * - Every question is optional, and "No thanks" is an answer too.
 * - Management sees each response with the student's name. The course's
 *   tutors see the answers without names, and only once the form has closed,
 *   so the order and timing of answers cannot point at a student.
 */

export const FEEDBACK_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const FEEDBACK_WINDOW_MS = FEEDBACK_WINDOW_DAYS * DAY_MS;

/**
 * The minute cron emails a course's students once, when its last class has
 * ended. It looks back this far so a missed tick or a short outage still
 * sends it, but never invites a course that ended long before this feature.
 */
export const FEEDBACK_INVITE_LOOKBACK_MS = 2 * DAY_MS;

export const MAX_NEXT_COURSE_LENGTH = 200;
export const MAX_COMMENTS_LENGTH = 2000;

export const PACE_OPTIONS = [
  { value: "too_slow", label: "Too slow" },
  { value: "about_right", label: "About right" },
  { value: "too_fast", label: "Too fast" },
] as const;
export type Pace = (typeof PACE_OPTIONS)[number]["value"];

export const ANOTHER_COURSE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
] as const;
export type AnotherCourse = (typeof ANOTHER_COURSE_OPTIONS)[number]["value"];

export type FeedbackAnswers = {
  courseRating: number | null;
  tutorRating: number | null;
  pace: Pace | null;
  anotherCourse: AnotherCourse | null;
  nextCourse: string | null;
  comments: string | null;
};

/** A row of public.course_feedback. */
export type CourseFeedbackRow = {
  id: string;
  course_id: string;
  student_id: string;
  course_rating: number | null;
  tutor_rating: number | null;
  pace: string | null;
  another_course: string | null;
  next_course: string | null;
  comments: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
};

type ClassTimes = { starts_at: string | null; duration_hours?: unknown };

/** When the course's last class ends, or null for a course with no dated class. */
export const courseEndMs = (classes: readonly ClassTimes[] | null | undefined): number | null => {
  let latest: number | null = null;
  for (const lesson of classes ?? []) {
    const startMs = lesson.starts_at ? Date.parse(lesson.starts_at) : Number.NaN;
    if (!Number.isFinite(startMs)) continue;
    const endMs = classEndMs(startMs, lesson.duration_hours);
    if (latest === null || endMs > latest) latest = endMs;
  }
  return latest;
};

export type FeedbackWindow =
  | { status: "no_classes" }
  | { status: "running"; endsAtMs: number }
  | { status: "open"; endedAtMs: number; closesAtMs: number }
  | { status: "closed"; endedAtMs: number; closedAtMs: number };

type FeedbackCourse = {
  deleted_at?: string | null;
  is_completed?: boolean | null;
  course_classes?: readonly ClassTimes[] | null;
};

/**
 * Where a course stands for feedback. Courses imported from before the
 * platform (`is_completed`, no scheduled classes) and deleted courses never
 * collect feedback.
 */
export const feedbackWindow = (course: FeedbackCourse, nowMs: number): FeedbackWindow => {
  const endedAtMs = course.deleted_at || course.is_completed ? null : courseEndMs(course.course_classes);
  if (endedAtMs === null) return { status: "no_classes" };
  if (endedAtMs > nowMs) return { status: "running", endsAtMs: endedAtMs };
  const closesAtMs = endedAtMs + FEEDBACK_WINDOW_MS;
  if (nowMs < closesAtMs) return { status: "open", endedAtMs, closesAtMs };
  return { status: "closed", endedAtMs, closedAtMs: closesAtMs };
};

/** Whether the cron should send the one-time invitation email now. */
export const shouldSendFeedbackInvite = (
  course: FeedbackCourse & { feedback_invited_at?: string | null },
  nowMs: number
): boolean => {
  if (course.feedback_invited_at) return false;
  const window = feedbackWindow(course, nowMs);
  return window.status === "open" && nowMs - window.endedAtMs <= FEEDBACK_INVITE_LOOKBACK_MS;
};

const readRating = (value: unknown): number | null | "invalid" => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : "invalid";
};

const readChoice = <T extends string>(value: unknown, allowed: readonly { value: T }[]): T | null | "invalid" => {
  if (value === null || value === undefined || value === "") return null;
  const match = allowed.find((option) => option.value === value);
  return match ? match.value : "invalid";
};

const readText = (value: unknown, max: number): string | null | "invalid" => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  return text.length <= max ? text : "invalid";
};

export type ParsedFeedback =
  | { ok: true; declined: true }
  | { ok: true; declined: false; answers: FeedbackAnswers }
  | { ok: false; error: string };

/**
 * Checks a submitted form. Each answer is optional, but a submission that is
 * not "No thanks" must answer at least one question.
 */
export const parseFeedbackSubmission = (body: unknown): ParsedFeedback => {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (input.declined === true) return { ok: true, declined: true };

  const courseRating = readRating(input.courseRating);
  const tutorRating = readRating(input.tutorRating);
  if (courseRating === "invalid" || tutorRating === "invalid") {
    return { ok: false, error: "Ratings go from 1 to 5." };
  }
  const pace = readChoice(input.pace, PACE_OPTIONS);
  const anotherCourse = readChoice(input.anotherCourse, ANOTHER_COURSE_OPTIONS);
  if (pace === "invalid" || anotherCourse === "invalid") {
    return { ok: false, error: "Pick one of the choices given." };
  }
  const nextCourse = readText(input.nextCourse, MAX_NEXT_COURSE_LENGTH);
  if (nextCourse === "invalid") {
    return { ok: false, error: `Keep the next course to ${MAX_NEXT_COURSE_LENGTH} characters.` };
  }
  const comments = readText(input.comments, MAX_COMMENTS_LENGTH);
  if (comments === "invalid") {
    return { ok: false, error: `Keep comments to ${MAX_COMMENTS_LENGTH} characters.` };
  }

  const answers: FeedbackAnswers = { courseRating, tutorRating, pace, anotherCourse, nextCourse, comments };
  if (Object.values(answers).every((value) => value === null)) {
    return { ok: false, error: "Answer at least one question, or choose No thanks." };
  }
  return { ok: true, declined: false, answers };
};

/** The columns to write for a parsed submission. */
export const feedbackColumns = (parsed: Extract<ParsedFeedback, { ok: true }>, nowIso: string) =>
  parsed.declined
    ? {
        course_rating: null, tutor_rating: null, pace: null, another_course: null,
        next_course: null, comments: null, declined_at: nowIso, updated_at: nowIso,
      }
    : {
        course_rating: parsed.answers.courseRating,
        tutor_rating: parsed.answers.tutorRating,
        pace: parsed.answers.pace,
        another_course: parsed.answers.anotherCourse,
        next_course: parsed.answers.nextCourse,
        comments: parsed.answers.comments,
        declined_at: null,
        updated_at: nowIso,
      };

/** The answers a row holds, in the shape the pages use. */
export const rowAnswers = (row: CourseFeedbackRow): FeedbackAnswers => ({
  courseRating: row.course_rating,
  tutorRating: row.tutor_rating,
  pace: (PACE_OPTIONS.find((option) => option.value === row.pace)?.value ?? null),
  anotherCourse: (ANOTHER_COURSE_OPTIONS.find((option) => option.value === row.another_course)?.value ?? null),
  nextCourse: row.next_course,
  comments: row.comments,
});

export type FeedbackSummary = {
  responses: number;
  declined: number;
  courseRatingAverage: number | null;
  courseRatingCount: number;
  tutorRatingAverage: number | null;
  tutorRatingCount: number;
  pace: Record<Pace, number>;
  anotherCourse: Record<AnotherCourse, number>;
};

const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

/** Counts and averages over a course's rows. "No thanks" rows are only counted. */
export const summarizeFeedback = (rows: readonly CourseFeedbackRow[]): FeedbackSummary => {
  const answered = rows.filter((row) => !row.declined_at);
  const courseRatings = answered.map((row) => row.course_rating).filter((value): value is number => typeof value === "number");
  const tutorRatings = answered.map((row) => row.tutor_rating).filter((value): value is number => typeof value === "number");
  const pace = { too_slow: 0, about_right: 0, too_fast: 0 } as Record<Pace, number>;
  const anotherCourse = { yes: 0, maybe: 0, no: 0 } as Record<AnotherCourse, number>;
  for (const row of answered) {
    const answers = rowAnswers(row);
    if (answers.pace) pace[answers.pace] += 1;
    if (answers.anotherCourse) anotherCourse[answers.anotherCourse] += 1;
  }
  return {
    responses: answered.length,
    declined: rows.length - answered.length,
    courseRatingAverage: average(courseRatings),
    courseRatingCount: courseRatings.length,
    tutorRatingAverage: average(tutorRatings),
    tutorRatingCount: tutorRatings.length,
    pace,
    anotherCourse,
  };
};

const stableHash = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * What a course's tutors may see: the answers with no student, no row id and
 * no time, in an order that follows neither when nor who. Empty until the
 * form has closed.
 */
export const anonymousAnswersForTutor = (
  rows: readonly CourseFeedbackRow[],
  window: FeedbackWindow
): FeedbackAnswers[] => {
  if (window.status !== "closed") return [];
  return rows
    .filter((row) => !row.declined_at)
    .map((row) => ({ key: stableHash(`${row.course_id}:${row.id}`), answers: rowAnswers(row) }))
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.answers);
};

export const paceLabel = (value: string | null | undefined) =>
  PACE_OPTIONS.find((option) => option.value === value)?.label ?? null;

export const anotherCourseLabel = (value: string | null | undefined) =>
  ANOTHER_COURSE_OPTIONS.find((option) => option.value === value)?.label ?? null;
