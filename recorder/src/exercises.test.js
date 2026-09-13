// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("recorder/src/index.html", "utf8");
const source = readFileSync("recorder/src/exercises.js", "utf8");
let api, context, fixture, controller;
const $ = id => document.getElementById(id);
const flush = () => vi.advanceTimersByTimeAsync(0);
const click = async id => { $(id).click(); await flush(); };
const question = () => ({ id: "q1", number: 1, prompt: "def solve():\n    pass", opened_at: new Date().toISOString(), closes_at: new Date(Date.now() + 180000).toISOString(), stopped_at: null });
const publish = async () => { $("exercises-draft").value = "Write a function.\n    Preserve this indentation."; $("exercises-publish").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1];
  context = { token: "test-token", serverUrl: "https://example.test", test: false, classId: "class1" };
  fixture = { currentQuestionId: "q1", questions: [question()], submissions: [], announced: true, serverNow: Date.now() };
  api = vi.fn(async (url, options) => {
    if (url === "/api/recorder/exercises") return { ok: true, data: { classes: [{ id: "class1", title: "Class 1", courseTitle: "Python", startsAt: new Date().toISOString() }] } };
    const body = options?.body;
    if (body?.action === "publish") {
      fixture.questions[0].stopped_at = new Date().toISOString();
      fixture.questions.unshift({ ...question(), id: body.id, prompt: body.prompt, number: fixture.questions.length + 1 });
      fixture.currentQuestionId = body.id;
    } else if (body?.action === "stop") fixture.questions.find(q => q.id === body.questionId).stopped_at = new Date().toISOString();
    else if (body?.action === "grade") Object.assign(fixture.submissions.find(s => s.id === body.submissionId), { status: body.status, feedback: body.feedback });
    return { ok: true, data: structuredClone({ ...fixture, serverNow: Date.now() }) };
  });
  window.eval(source);
  controller = window.createRecorderExercises({ api, context: () => context, showView: name => {
    $("panel-exercises").hidden = name !== "exercises"; $("view-main").hidden = name !== "main";
  } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("Recorder exercise interface", () => {
  it("loads a selected class independently of recording and keeps one copyable link", async () => {
    await click("exercises-button");
    expect($("panel-exercises").hidden).toBe(false);
    expect($("exercises-countdown").textContent).toBe("3:00 left");
    const link = $("exercises-link").value;
    await publish();
    expect($("exercises-link").value).toBe(link);
    expect($("exercises-number").textContent).toBe("Question 2");
    expect($("exercises-draft").value).toBe("");
    expect(controller.active()).toBe(true); // Updates must not restart an exercise.
  });
  it("preserves a focused feedback draft while new answers arrive", async () => {
    fixture.submissions.push({ id: "s1", question_id: "q1", student_id: "alice", studentName: "Alice", attempt: 1, answer: "<script>danger()</script>\n    code", status: "pending", feedback: "" });
    await click("exercises-button");
    const editor = $("exercises-responses").querySelector("textarea");
    editor.focus(); editor.value = "Try:\n    return 1"; editor.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.submissions.push({ id: "s2", question_id: "q1", student_id: "bob", studentName: "Bob", attempt: 1, answer: "Hello", status: "pending", feedback: "" });
    await vi.advanceTimersByTimeAsync(2100);
    expect($("exercises-responses").querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Try:\n    return 1");
    expect($("exercises-responses").querySelector("script")).toBeNull();
    editor.blur(); await vi.advanceTimersByTimeAsync(2100);
    expect($("exercises-responses").querySelector("textarea").value).toBe("Try:\n    return 1");
    expect($("exercises-summary").textContent).toContain("2 students");
    $("exercises-responses").querySelectorAll("button")[1].click(); await flush();
    expect(fixture.submissions[0].status).toBe("incorrect");
    expect(fixture.submissions[0].feedback).toBe("Try:\n    return 1");
  });
  it("expires even without a successful poll and stops without losing the question", async () => {
    await click("exercises-button");
    api.mockRejectedValue(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(180000);
    expect($("exercises-countdown").textContent).toBe("Submissions closed");
    expect($("exercises-stop").disabled).toBe(true);
    expect($("exercises-prompt").textContent).toContain("def solve");
  });
  it("switches visible responses when a new question arrives without losing an earlier feedback draft", async () => {
    fixture.submissions.push({ id: "s1", question_id: "q1", student_id: "alice", studentName: "Alice", attempt: 1, answer: "Old answer", status: "pending", feedback: "" });
    await click("exercises-button");
    const editor = $("exercises-responses").querySelector("textarea");
    editor.focus(); editor.value = "Unsent feedback"; editor.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.questions.unshift({ ...question(), id: "q2", number: 2 }); fixture.currentQuestionId = "q2";
    await vi.advanceTimersByTimeAsync(2100);
    expect($("exercises-responses").textContent).not.toContain("Old answer");
    $("exercises-review").value = "q1"; $("exercises-review").dispatchEvent(new Event("change")); await flush();
    expect($("exercises-responses").querySelector("textarea").value).toBe("Unsent feedback");
  });
  it("recognizes a saved publish after a lost response rather than duplicating the question", async () => {
    await click("exercises-button");
    const original = api.getMockImplementation();
    api.mockImplementation(async (url, options) => {
      const result = await original(url, options);
      if (options?.body?.action === "publish") throw new Error("Response lost");
      return result;
    });
    await publish();
    expect(fixture.questions).toHaveLength(2);
    expect($("exercises-draft").value).toBe("");
    expect($("exercises-number").textContent).toBe("Question 2");
  });
  it("supports publishing, sample answers, marking and corrections in practice with zero API calls", async () => {
    context.test = true;
    await click("exercises-button"); await publish(); await click("exercises-sample");
    expect($("exercises-copy").disabled).toBe(true);
    expect($("exercises-summary").textContent).toContain("1 students");
    $("exercises-responses").querySelectorAll("button")[1].click(); await flush();
    await click("exercises-sample");
    expect($("exercises-responses").textContent).toContain("attempt 2");
    await click("exercises-stop");
    expect($("exercises-countdown").textContent).toBe("Submissions closed");
    expect($("exercises-sample").disabled).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });
  it("clears sensitive exercise state on sign-out", async () => {
    await click("exercises-button"); controller.reset();
    expect($("exercises-prompt").textContent).toBe("");
    expect($("exercises-responses").textContent).toBe("");
    expect($("exercises-link").value).toBe("");
    expect(controller.active()).toBe(false);
  });
});
