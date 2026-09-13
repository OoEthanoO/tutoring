// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClassExerciseStudent from "./ClassExerciseStudent";
import type { ExerciseState } from "@/lib/classExercises";
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

let root: Root, container: HTMLDivElement, fixture: ExerciseState;
type FixtureFetch = (url: string, options?: { method?: string; body?: string }) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FixtureFetch>>;
const answerInput = () => container.querySelector<HTMLTextAreaElement>("#exercise-answer")!;
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const fill = async (value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(answerInput(), value);
    answerInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const send = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush(); };

beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture = { classId: "class1", courseTitle: "Python", classTitle: "Class 1", startsAt: new Date().toISOString(), currentQuestionId: "q1", questions: [{ id: "q1", class_id: "class1", number: 1, prompt: "def example():\n    pass", opened_at: new Date().toISOString(), closes_at: new Date(Date.now() + 180000).toISOString(), stopped_at: null }], submissions: [], serverNow: Date.now(), canSubmit: true, announced: true, link: "/class-exercises/class1" };
  fetchMock = vi.fn<FixtureFetch>(async (_url, options) => {
    if (options?.method === "POST") {
      const b = JSON.parse(options.body!);
      fixture.submissions.push({ id: b.id, question_id: b.questionId, student_id: "alice", attempt: fixture.submissions.length + 1, answer: b.answer, status: "pending", feedback: "", submitted_at: new Date().toISOString(), graded_at: null });
    }
    return Response.json({ ...fixture, serverNow: Date.now() });
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<ClassExerciseStudent classId="class1" />); }); await flush();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("student exercise page", () => {
  it("keeps code indentation through polling, submission, feedback and resubmission", async () => {
    const code = "def solve():\n\treturn 1\n\n";
    await fill(code); await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(answerInput().value).toBe(code);
    await send(); expect(fixture.submissions[0].answer).toBe(code);
    expect(answerInput().disabled).toBe(true);
    fixture.submissions[0].status = "incorrect"; fixture.submissions[0].feedback = "Try:\n    return 2";
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(container.textContent).toContain("Try:\n    return 2"); expect(answerInput().disabled).toBe(false);
    await fill("def solve():\n    return 2\n"); await send();
    expect(fixture.submissions).toHaveLength(2);
    fixture.submissions[1].status = "correct";
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(container.textContent).toContain("you’re done"); expect(answerInput().disabled).toBe(true);
  });
  it("moves to the new question on the same page and disables a frozen question", async () => {
    await fill("Unsent draft");
    fixture.questions[0].stopped_at = new Date().toISOString();
    fixture.questions.unshift({ ...fixture.questions[0], id: "q2", number: 2, prompt: "New question", stopped_at: null }); fixture.currentQuestionId = "q2";
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(container.textContent).toContain("New question"); expect(answerInput().value).toBe("");
    fixture.questions[0].stopped_at = new Date().toISOString();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(answerInput().disabled).toBe(true); expect(container.textContent).toContain("Submissions closed");
  });
  it("recovers a lost submission response before allowing another attempt", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      const result = await original(url, options);
      if (options?.method === "POST") throw new Error("Response lost");
      return result;
    });
    await fill("Same answer"); await send();
    const firstId = fixture.submissions[0].id;
    expect(answerInput().disabled).toBe(true);
    fixture.submissions[0].status = "incorrect";
    fetchMock.mockImplementation(original);
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    await send();
    expect(fixture.submissions).toHaveLength(2);
    expect(fixture.submissions[1].id).not.toBe(firstId);
  });
  it("closes at zero without needing a server response", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
    expect(answerInput().disabled).toBe(true); expect(container.textContent).toContain("Submissions closed");
  });
  it("hides private answers when authentication expires", async () => {
    await fill("secret answer"); await send();
    fetchMock.mockResolvedValue(Response.json({ error: "Sign in" }, { status: 401 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(container.textContent).not.toContain("secret answer");
    expect(container.querySelector('a[href^="/login?next="]')).not.toBeNull();
  });
});
