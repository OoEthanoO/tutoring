import { NextResponse } from "next/server";
import { getAdminClient, type SessionUser } from "@/lib/authServer";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import { exerciseIdValid, validateExerciseAction, type ExerciseQuestion, type ExerciseSubmission, type ExerciseState } from "@/lib/classExercises";
import { sendDiscordCourseRoleMessage } from "@/lib/notificationsServer";
import { escapeDiscordMarkdown } from "@/lib/courseNeeds";

export class ExerciseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Course = { id: string; title: string; created_by: string | null; co_tutor_id: string | null; deleted_at: string | null };
type ClassRow = { id: string; title: string; starts_at: string; course: Course };
export type ExerciseAccess = { db: ReturnType<typeof getAdminClient>; user: SessionUser; lesson: ClassRow; enrolled: boolean };
export const canTeachExercises = (user: SessionUser, course: Course) =>
  isFounder(resolveAccountRole(user)) || course.created_by === user.id || course.co_tutor_id === user.id;

export async function getExerciseAccess(user: SessionUser | null, classId: string, tutor: boolean): Promise<ExerciseAccess> {
  if (!user) throw new ExerciseError("Sign in to YanLearn to open this class exercise.", 401);
  if (!exerciseIdValid(classId)) throw new ExerciseError("Class not found.", 404);
  const db = getAdminClient();
  const { data, error } = await db.from("course_classes")
    .select("id, title, starts_at, course:courses!inner(id, title, created_by, co_tutor_id, deleted_at)")
    .eq("id", classId).maybeSingle();
  if (error) throw error;
  const lesson = data as unknown as ClassRow | null;
  if (!lesson || lesson.course.deleted_at) throw new ExerciseError("Class not found.", 404);
  const teaches = canTeachExercises(user, lesson.course);
  if (tutor && !teaches) throw new ExerciseError("Only this course's tutors and YanLearn management can manage these exercises.", 403);
  const { data: enrollment, error: enrollmentError } = await db.from("course_enrollments")
    .select("id").eq("course_id", lesson.course.id).eq("student_id", user.id).maybeSingle();
  if (enrollmentError) throw enrollmentError;
  if (!tutor && !teaches && !enrollment) throw new ExerciseError("You must be enrolled in this course to open its exercises.", 403);
  return { db, user, lesson, enrolled: !!enrollment };
}

export async function readExerciseState(access: ExerciseAccess, tutor: boolean, reviewQuestionId?: string | null): Promise<ExerciseState> {
  const { db, lesson, user } = access;
  const { data: room, error: roomError } = await db.from("class_exercise_rooms")
    .select("current_question_id, announced_at").eq("class_id", lesson.id).maybeSingle();
  if (roomError) throw roomError;
  const { data: rows, error } = await db.from("class_exercise_questions")
    .select("id, class_id, number, prompt, opened_at, closes_at, stopped_at")
    .eq("class_id", lesson.id).order("number", { ascending: false });
  if (error) throw error;
  const questions = (rows ?? []) as ExerciseQuestion[];
  // Tutors poll the active question and the one they are reviewing, rather than
  // downloading every student's full history for every question every two seconds.
  const questionIds = questions.filter(q => !tutor || q.id === room?.current_question_id || q.id === reviewQuestionId).map(q => q.id);
  const submissions: ExerciseSubmission[] = [];
  if (questionIds.length) {
    // Filter student identity in the database, before any response data is built.
    // Page through attempts so a large class never silently loses submissions.
    for (let offset = 0; ; offset += 500) {
      let query = db.from("class_exercise_submissions")
        .select(`id, question_id, student_id, attempt, answer, status, feedback, submitted_at, graded_at${tutor ? ", student:app_users!student_id(full_name, email)" : ""}`)
        .in("question_id", questionIds).order("submitted_at").order("id").range(offset, offset + 499);
      if (!tutor) query = query.eq("student_id", user.id);
      const { data, error: submissionError } = await query;
      if (submissionError) throw submissionError;
      const batch = (data ?? []) as unknown as (ExerciseSubmission & { student?: { full_name: string | null; email: string } })[];
      submissions.push(...batch.map(({ student, ...s }) => tutor ? { ...s, studentName: student?.full_name || student?.email || "Deleted account" } : s));
      if (batch.length < 500) break;
    }
  }
  return {
    classId: lesson.id, classTitle: lesson.title, courseTitle: lesson.course.title, startsAt: lesson.starts_at,
    currentQuestionId: room?.current_question_id ?? null, questions, submissions,
    serverNow: Date.now(), canSubmit: access.enrolled, announced: !!room?.announced_at,
    link: `/class-exercises/${lesson.id}`,
  };
}

export async function announceExerciseLink(access: ExerciseAccess) {
  const { db, user, lesson } = access;
  const args = { p_class_id: lesson.id, p_actor: user.id };
  const { data: claim, error } = await db.rpc("class_exercise_action", { ...args, p_action: "claim_announcement", p_input: {} });
  if (error) throw error;
  if (!claim) return;
  // Fixed trusted website origin: never allow a caller-supplied Host to become a Discord link.
  const link = `https://learn.ethanyanxu.com/class-exercises/${lesson.id}`;
  const sent = await sendDiscordCourseRoleMessage(lesson.course.id, roleId =>
    `<@&${roleId}> **In-class exercises — ${escapeDiscordMarkdown(lesson.title).slice(0, 200)}**\n${link}\nSign in to answer privately. Keep this link open for every question in this class; the question and countdown update here.`,
    { nonce: `ex${lesson.id.replaceAll("-", "").slice(0, 23)}` });
  const { error: finishError } = await db.rpc("class_exercise_action", { ...args, p_action: "finish_announcement", p_input: { claim, sent } });
  if (finishError) throw finishError;
  if (!sent) throw new ExerciseError("The question is live, but Discord could not post the link. Copy the link or retry the announcement.", 502);
}

export async function mutateExercise(access: ExerciseAccess, body: Record<string, unknown>, student: boolean) {
  const validation = validateExerciseAction(body.action, body, student);
  if (validation) throw new ExerciseError(validation);
  if (student && !access.enrolled) throw new ExerciseError("Enroll in the course to submit an answer.", 403);
  if (body.action !== "announce") {
    const { error } = await access.db.rpc("class_exercise_action", {
      p_class_id: access.lesson.id, p_actor: access.user.id, p_action: body.action, p_input: body,
    });
    if (error) {
      if (error.code === "P0001") throw new ExerciseError(error.message, 409);
      throw error;
    }
  }
  if (body.action === "publish" || body.action === "announce") await announceExerciseLink(access);
}

export const exerciseJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export function exerciseFailure(error: unknown) {
  if (error instanceof ExerciseError) return exerciseJson({ error: error.message }, error.status);
  console.error("Class exercise request failed:", error);
  return exerciseJson({ error: "Unable to load or save this exercise. Please try again." }, 500);
}
export async function exerciseBody(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ExerciseError("Invalid exercise request.");
  return body as Record<string, unknown>;
}
