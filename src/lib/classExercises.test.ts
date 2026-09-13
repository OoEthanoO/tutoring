import { describe, expect, it } from "vitest";
import { exerciseCanSubmit, exerciseIdValid, exerciseOpen, exerciseReturnTo, exerciseSecondsLeft, validateExerciseAction, type ExerciseQuestion, type ExerciseSubmission } from "./classExercises";
const id = "01234567-1234-1234-1234-012345678901";
const q: ExerciseQuestion = { id, class_id: id, number: 1, prompt: "Hi", opened_at: "2026-09-13T20:00:00Z", closes_at: "2026-09-13T20:03:00Z", stopped_at: null };
describe("exercise controls", () => {
  it("uses the same exact deadline and current question for both clients", () => {
    expect(exerciseSecondsLeft(q, id, Date.parse(q.closes_at) - 1)).toBe(1);
    expect(exerciseSecondsLeft(q, id, Date.parse(q.closes_at))).toBe(0);
    expect(exerciseOpen(q, "other", Date.parse(q.opened_at))).toBe(false);
    expect(exerciseOpen({ ...q, stopped_at: q.opened_at }, id, Date.parse(q.opened_at))).toBe(false);
    expect(exerciseOpen(q, id, Date.parse(q.opened_at) - 1)).toBe(false);
  });
  it("allows only first answers or corrections while open", () => {
    expect(exerciseCanSubmit(true)).toBe(true);
    for (const status of ["correct", "pending", "incorrect"] as const) {
      expect(exerciseCanSubmit(true, { status } as ExerciseSubmission)).toBe(status === "incorrect");
      expect(exerciseCanSubmit(false, { status } as ExerciseSubmission)).toBe(false);
    }
  });
  it("allows indentation and multiline submissions without modifying them", () => {
    const input = { id, questionId: id, answer: "\n\tdef fn():\n    return 1\n" };
    expect(validateExerciseAction("submit", input, true)).toBeNull();
    expect(input.answer.startsWith("\n\t")).toBe(true);
    expect(validateExerciseAction("submit", { ...input, answer: "\n\t " }, true)).toBeTruthy();
  });
  it("rejects student tutor actions, malformed IDs, huge text and invalid durations", () => {
    for (const action of ["publish", "grade", "stop", "announce", "claim_announcement", "finish_announcement"]) expect(validateExerciseAction(action, {}, true)).toBeTruthy();
    expect(validateExerciseAction("submit", { id, questionId: id, answer: "x".repeat(30001) }, true)).toBeTruthy();
    for (const seconds of [0, 9, 7201, 10.5, "180", NaN]) expect(validateExerciseAction("publish", { id, prompt: "Hi", durationSeconds: seconds }, false)).toBeTruthy();
    expect(exerciseIdValid("../../admin")).toBe(false);
  });
  it("returns only to valid local exercise links after sign-in", () => {
    expect(exerciseReturnTo(`/class-exercises/${id}`)).toBe(`/class-exercises/${id}`);
    for (const path of ["https://evil.test", "//evil.test", "/class-exercises/../admin", `/class-exercises/${id}?url=evil`, undefined]) expect(exerciseReturnTo(path)).toBe("/");
  });
});
