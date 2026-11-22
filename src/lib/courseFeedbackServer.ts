import type { SupabaseClient } from "@supabase/supabase-js";
import { chunks, fetchAllRows, idChunkSize } from "@/lib/supabasePaging";
import { sendBccEmail } from "@/lib/notificationsServer";
import {
  FEEDBACK_INVITE_LOOKBACK_MS,
  FEEDBACK_WINDOW_DAYS,
  anonymousAnswersForTutor,
  feedbackWindow,
  rowAnswers,
  shouldSendFeedbackInvite,
  summarizeFeedback,
  type CourseFeedbackRow,
  type FeedbackAnswers,
  type FeedbackSummary,
  type FeedbackWindow,
} from "@/lib/courseFeedback";

/**
 * Database reads and writes for post-course feedback (COURSE_FEEDBACK.md).
 * The rules themselves are in courseFeedback.ts.
 */

type ClassTimes = { starts_at: string | null; duration_hours: number | string | null };
type FeedbackCourseRow = {
  id: string;
  title: string | null;
  deleted_at: string | null;
  is_completed: boolean | null;
  created_by: string | null;
  co_tutor_id: string | null;
  created_by_name: string | null;
  feedback_invited_at: string | null;
  course_classes: ClassTimes[] | null;
};

const courseColumns =
  "id, title, deleted_at, is_completed, created_by, co_tutor_id, created_by_name, feedback_invited_at, course_classes(starts_at, duration_hours)";
const feedbackColumnsList =
  "id, course_id, student_id, course_rating, tutor_rating, pace, another_course, next_course, comments, declined_at, created_at, updated_at";

const iso = (ms: number) => new Date(ms).toISOString();
const courseTitle = (course: { title: string | null }) => String(course.title ?? "").trim() || "Untitled course";

const loadCourses = async (client: SupabaseClient, ids: string[]): Promise<FeedbackCourseRow[]> => {
  const rows: FeedbackCourseRow[] = [];
  for (const piece of chunks(ids, idChunkSize)) {
    const { data, error } = await client.from("courses").select(courseColumns).in("id", piece);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as FeedbackCourseRow[]));
  }
  return rows;
};

const loadFeedbackRows = async (client: SupabaseClient, courseIds: string[]): Promise<CourseFeedbackRow[]> => {
  const rows: CourseFeedbackRow[] = [];
  for (const piece of chunks(courseIds, idChunkSize)) {
    rows.push(...(await fetchAllRows<CourseFeedbackRow>((from, to) =>
      client.from("course_feedback").select(feedbackColumnsList).in("course_id", piece)
        .order("id", { ascending: true }).range(from, to)
    )));
  }
  return rows;
};

const windowDates = (window: FeedbackWindow) =>
  window.status === "open"
    ? { endedAt: iso(window.endedAtMs), closesAt: iso(window.closesAtMs) }
    : window.status === "closed"
      ? { endedAt: iso(window.endedAtMs), closesAt: iso(window.closedAtMs) }
      : { endedAt: null, closesAt: null };

// --- Students ---------------------------------------------------------------

export type StudentFeedbackForm = {
  courseId: string;
  title: string;
  tutorName: string | null;
  endedAt: string;
  closesAt: string;
  answers: FeedbackAnswers | null;
  declined: boolean;
  savedAt: string | null;
};

/** The open forms for this student: courses they are enrolled in whose last class ended in the last 30 days. */
export const loadStudentFeedbackForms = async (
  client: SupabaseClient,
  studentId: string,
  nowMs: number
): Promise<StudentFeedbackForm[]> => {
  const { data: enrollments, error } = await client
    .from("course_enrollments").select("course_id").eq("student_id", studentId);
  if (error) throw new Error(error.message);
  const courseIds = Array.from(new Set((enrollments ?? []).map((row) => String(row.course_id))));
  if (courseIds.length === 0) return [];

  const open = (await loadCourses(client, courseIds))
    .map((course) => ({ course, window: feedbackWindow(course, nowMs) }))
    .filter((entry): entry is { course: FeedbackCourseRow; window: Extract<FeedbackWindow, { status: "open" }> } =>
      entry.window.status === "open");
  if (open.length === 0) return [];

  const { data: mine, error: feedbackError } = await client
    .from("course_feedback").select(feedbackColumnsList)
    .eq("student_id", studentId).in("course_id", open.map((entry) => entry.course.id));
  if (feedbackError) throw new Error(feedbackError.message);
  const byCourse = new Map(((mine ?? []) as CourseFeedbackRow[]).map((row) => [String(row.course_id), row]));

  return open
    .sort((left, right) => right.window.endedAtMs - left.window.endedAtMs)
    .map(({ course, window }) => {
      const row = byCourse.get(course.id) ?? null;
      return {
        courseId: course.id,
        title: courseTitle(course),
        tutorName: course.created_by_name ?? null,
        endedAt: iso(window.endedAtMs),
        closesAt: iso(window.closesAtMs),
        answers: row && !row.declined_at ? rowAnswers(row) : null,
        declined: Boolean(row?.declined_at),
        savedAt: row?.updated_at ?? null,
      };
    });
};

export type FeedbackSaveOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Saves (or replaces) a student's answers for one course, if they may still answer. */
export const saveStudentFeedback = async (
  client: SupabaseClient,
  studentId: string,
  courseId: string,
  columns: Record<string, unknown>,
  nowMs: number
): Promise<FeedbackSaveOutcome> => {
  const { data: enrollment, error: enrollmentError } = await client
    .from("course_enrollments").select("course_id")
    .eq("course_id", courseId).eq("student_id", studentId).maybeSingle();
  if (enrollmentError) return { ok: false, status: 503, error: "Could not check your enrollment." };
  if (!enrollment) return { ok: false, status: 403, error: "You can only give feedback on a course you were enrolled in." };

  const [course] = await loadCourses(client, [courseId]);
  const window = course ? feedbackWindow(course, nowMs) : { status: "no_classes" as const };
  if (window.status === "running") {
    return { ok: false, status: 409, error: "The form opens when the course's last class ends." };
  }
  if (window.status !== "open") {
    return { ok: false, status: 409, error: `The form for this course has closed (it stays open ${FEEDBACK_WINDOW_DAYS} days).` };
  }

  const { error } = await client.from("course_feedback").upsert(
    { course_id: courseId, student_id: studentId, ...columns },
    { onConflict: "course_id,student_id" }
  );
  if (error) return { ok: false, status: 500, error: "Could not save your answers." };
  return { ok: true };
};

// --- Tutors -----------------------------------------------------------------

export type TutorFeedbackCourse = {
  courseId: string;
  title: string;
  endedAt: string;
  status: "open" | "closed";
  /** While open: when the answers appear. Once closed: when they appeared. */
  closesAt: string;
  summary: FeedbackSummary | null;
  answers: FeedbackAnswers[];
};

/**
 * The tutor's own ended courses (owned or co-taught). Answers appear without
 * names, and only after the form has closed; until then not even the number
 * of answers is shown.
 */
export const loadTutorFeedback = async (
  client: SupabaseClient,
  tutorId: string,
  nowMs: number
): Promise<TutorFeedbackCourse[]> => {
  const [owned, coTaught] = await Promise.all([
    client.from("courses").select(courseColumns).eq("created_by", tutorId).is("deleted_at", null),
    client.from("courses").select(courseColumns).eq("co_tutor_id", tutorId).is("deleted_at", null),
  ]);
  if (owned.error || coTaught.error) throw new Error((owned.error ?? coTaught.error)?.message ?? "Could not load courses.");
  const courses = new Map<string, FeedbackCourseRow>();
  for (const course of [...(owned.data ?? []), ...(coTaught.data ?? [])] as unknown as FeedbackCourseRow[]) {
    courses.set(course.id, course);
  }

  const ended = Array.from(courses.values())
    .map((course) => ({ course, window: feedbackWindow(course, nowMs) }))
    .filter((entry) => entry.window.status === "open" || entry.window.status === "closed");
  const closedIds = ended.filter((entry) => entry.window.status === "closed").map((entry) => entry.course.id);
  const rows = closedIds.length ? await loadFeedbackRows(client, closedIds) : [];

  return ended
    .map(({ course, window }) => {
      const courseRows = rows.filter((row) => String(row.course_id) === course.id);
      const dates = windowDates(window);
      const closed = window.status === "closed";
      return {
        courseId: course.id,
        title: courseTitle(course),
        endedAt: dates.endedAt as string,
        status: closed ? "closed" as const : "open" as const,
        closesAt: dates.closesAt as string,
        summary: closed ? summarizeFeedback(courseRows) : null,
        answers: anonymousAnswersForTutor(courseRows, window),
      };
    })
    .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
};

// --- Management -------------------------------------------------------------

export type ManagedFeedbackResponse = {
  studentName: string;
  declined: boolean;
  answers: FeedbackAnswers | null;
  savedAt: string;
};

export type ManagedFeedbackCourse = {
  courseId: string;
  title: string;
  tutorName: string | null;
  endedAt: string;
  status: "open" | "closed";
  closesAt: string;
  invitedAt: string | null;
  enrolledCount: number;
  summary: FeedbackSummary;
  responses: ManagedFeedbackResponse[];
};

/** How far back management's list reaches for courses with no answers yet. */
const MANAGEMENT_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Every ended course with answers, plus courses that ended in the last 120
 * days without any, each response with the student's name.
 */
export const loadManagementFeedback = async (
  client: SupabaseClient,
  nowMs: number
): Promise<ManagedFeedbackCourse[]> => {
  const rows = await fetchAllRows<CourseFeedbackRow>((from, to) =>
    client.from("course_feedback").select(feedbackColumnsList).order("id", { ascending: true }).range(from, to)
  );
  const courses = await fetchAllRows<FeedbackCourseRow>((from, to) =>
    client.from("courses").select(courseColumns).is("deleted_at", null).order("id", { ascending: true }).range(from, to)
  );
  const withRows = new Set(rows.map((row) => String(row.course_id)));
  const listed = courses
    .map((course) => ({ course, window: feedbackWindow(course, nowMs) }))
    .filter(({ course, window }) =>
      (window.status === "open" || window.status === "closed") &&
      (withRows.has(course.id) || nowMs - window.endedAtMs <= MANAGEMENT_LOOKBACK_MS));
  if (listed.length === 0) return [];

  const listedIds = listed.map((entry) => entry.course.id);
  const enrollments: { course_id: string; student_id: string; student_name: string | null }[] = [];
  for (const piece of chunks(listedIds, idChunkSize)) {
    enrollments.push(...(await fetchAllRows<{ course_id: string; student_id: string; student_name: string | null }>((from, to) =>
      client.from("course_enrollments").select("course_id, student_id, student_name")
        .in("course_id", piece).order("id", { ascending: true }).range(from, to)
    )));
  }
  const studentIds = Array.from(new Set(rows.map((row) => String(row.student_id))));
  const userNames = new Map<string, string>();
  for (const piece of chunks(studentIds, idChunkSize)) {
    const { data, error } = await client.from("app_users").select("id, full_name").in("id", piece);
    if (error) throw new Error(error.message);
    for (const user of data ?? []) userNames.set(String(user.id), String(user.full_name ?? "").trim());
  }
  const enrolledName = new Map(enrollments.map((row) => [`${row.course_id}:${row.student_id}`, String(row.student_name ?? "").trim()]));

  return listed
    .map(({ course, window }) => {
      const courseRows = rows.filter((row) => String(row.course_id) === course.id);
      const dates = windowDates(window);
      return {
        courseId: course.id,
        title: courseTitle(course),
        tutorName: course.created_by_name ?? null,
        endedAt: dates.endedAt as string,
        status: window.status === "closed" ? "closed" as const : "open" as const,
        closesAt: dates.closesAt as string,
        invitedAt: course.feedback_invited_at,
        enrolledCount: enrollments.filter((row) => String(row.course_id) === course.id).length,
        summary: summarizeFeedback(courseRows),
        responses: courseRows
          .map((row) => ({
            studentName: enrolledName.get(`${course.id}:${row.student_id}`) || userNames.get(String(row.student_id)) || "A student",
            declined: Boolean(row.declined_at),
            answers: row.declined_at ? null : rowAnswers(row),
            savedAt: row.updated_at,
          }))
          .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt)),
      };
    })
    .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
};

// --- The invitation email ---------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const siteUrl = () =>
  String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "") || "https://learn.ethanyanxu.com";

export const feedbackInviteEmail = (title: string, closesAt: Date, timeZone: string) => {
  const closes = closesAt.toLocaleDateString("en-CA", { timeZone, month: "long", day: "numeric", year: "numeric" });
  const link = `${siteUrl()}/?menu=enrolled_courses`;
  return {
    subject: `How was ${title}? (optional, about 2 minutes)`,
    html: `<p>Hi there,</p>
<p><strong>${escapeHtml(title)}</strong> has finished. Thank you for learning with YanLearn!</p>
<p>If you have two minutes, tell us how it went: open <a href="${link}">My enrollments</a> and fill in the short form at the top. Every question is optional, and you can answer until ${escapeHtml(closes)}.</p>
<p>Your tutor sees your answers without your name. YanLearn's leadership sees them with your name, so we can follow up if something went wrong.</p>
<p>Thanks,<br/>The YanLearn Team</p>`,
  };
};

export type FeedbackInviteResult = { invitedCourseIds: string[]; emailRecipients: number; errors: string[] };

/**
 * Emails each course's enrolled students once, soon after its last class.
 * The course is claimed (feedback_invited_at) before sending, so two
 * overlapping cron ticks can never send it twice; a failed send is reported,
 * not retried, since the form also waits on the site.
 */
export const sendFeedbackInvites = async (
  client: SupabaseClient,
  nowMs: number,
  timeZone: string
): Promise<FeedbackInviteResult> => {
  const result: FeedbackInviteResult = { invitedCourseIds: [], emailRecipients: 0, errors: [] };
  // A class that ended in the lookback started at most a day before it.
  const since = iso(nowMs - FEEDBACK_INVITE_LOOKBACK_MS - 24 * 60 * 60 * 1000);
  const { data: recentClasses, error } = await client
    .from("course_classes").select("course_id").gte("starts_at", since).lte("starts_at", iso(nowMs));
  if (error) {
    result.errors.push(`Could not load recent classes: ${error.message}`);
    return result;
  }
  const courseIds = Array.from(new Set((recentClasses ?? []).map((row) => String(row.course_id)).filter(Boolean)));
  if (courseIds.length === 0) return result;

  for (const course of await loadCourses(client, courseIds)) {
    if (!shouldSendFeedbackInvite(course, nowMs)) continue;
    const { data: claimed, error: claimError } = await client
      .from("courses").update({ feedback_invited_at: iso(nowMs) })
      .eq("id", course.id).is("feedback_invited_at", null).select("id");
    if (claimError) {
      result.errors.push(`Could not claim feedback invitation for course ${course.id}: ${claimError.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    const { data: enrolled, error: enrolledError } = await client
      .from("course_enrollments").select("student_email").eq("course_id", course.id);
    if (enrolledError) {
      result.errors.push(`Could not load students of course ${course.id}: ${enrolledError.message}`);
      continue;
    }
    const recipients = (enrolled ?? []).map((row) => String(row.student_email ?? "").trim()).filter(Boolean);
    result.invitedCourseIds.push(course.id);
    if (recipients.length === 0) continue;

    const window = feedbackWindow(course, nowMs);
    if (window.status !== "open") continue;
    const { subject, html } = feedbackInviteEmail(courseTitle(course), new Date(window.closesAtMs), timeZone);
    const { sentCount, failed } = await sendBccEmail(recipients, subject, html);
    result.emailRecipients += sentCount;
    for (const failure of failed) {
      result.errors.push(`Feedback invitation to ${failure.email} failed: ${failure.reason}`);
    }
  }
  return result;
};
