export type ExerciseQuestion = {
  id: string; class_id: string; number: number; prompt: string;
  opened_at: string; closes_at: string; stopped_at: string | null;
};
export type ExerciseSubmission = {
  id: string; question_id: string; student_id: string; attempt: number; answer: string;
  status: "pending" | "correct" | "incorrect"; feedback: string;
  submitted_at: string; graded_at: string | null; studentName?: string;
};
export type ExerciseState = {
  classId: string; courseTitle: string; classTitle: string; startsAt: string;
  currentQuestionId: string | null; questions: ExerciseQuestion[];
  submissions: ExerciseSubmission[]; serverNow: number; canSubmit: boolean;
  announced: boolean; link: string;
};
export const exerciseIdValid = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const exerciseReturnTo = (path: unknown) =>
  typeof path === "string" && path.startsWith("/class-exercises/") && exerciseIdValid(path.slice("/class-exercises/".length)) ? path : "/";
export const exerciseOpen = (question: ExerciseQuestion | undefined, currentId: string | null, now: number) =>
  !!question && question.id === currentId && !question.stopped_at && now >= Date.parse(question.opened_at) && now < Date.parse(question.closes_at);
export const exerciseSecondsLeft = (question: ExerciseQuestion | undefined, currentId: string | null, now: number) =>
  exerciseOpen(question, currentId, now) ? Math.max(0, Math.ceil((Date.parse(question!.closes_at) - now) / 1000)) : 0;
export const exerciseCanSubmit = (open: boolean, latest?: ExerciseSubmission) => open && (!latest || latest.status === "incorrect");

export function validateExerciseAction(action: unknown, input: Record<string, unknown>, student: boolean): string | null {
  if (!((student ? ["submit"] : ["publish", "stop", "grade", "announce"]).includes(String(action)))) return "Unknown exercise action.";
  const text = (value: unknown, max: number, required = true) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
  if (action === "publish" && (!exerciseIdValid(input.id) || !text(input.prompt, 16000) || !Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 10 || Number(input.durationSeconds) > 7200)) return "Enter a question and a duration between 10 seconds and 120 minutes.";
  if (action === "submit" && (!exerciseIdValid(input.id) || !exerciseIdValid(input.questionId) || !text(input.answer, 30000))) return "Enter an answer of at most 30,000 characters.";
  if (action === "stop" && !exerciseIdValid(input.questionId)) return "Choose a question to stop.";
  if (action === "grade" && (!exerciseIdValid(input.submissionId) || !["correct", "incorrect"].includes(String(input.status)) || !text(input.feedback, 10000, false))) return "Choose correct or incorrect and keep feedback under 10,000 characters.";
  return null;
}
