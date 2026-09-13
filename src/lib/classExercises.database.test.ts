import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Execute the actual migration in PostgreSQL, not a JS copy of its rules.
const db = new PGlite();
const tutor = randomUUID(), alice = randomUUID(), bob = randomUUID(), outsider = randomUUID();
const course = randomUUID(), lesson = randomUUID(), otherClass = randomUUID();
const act = async (action: string, input: Record<string, unknown>, actor = tutor, classId = lesson) =>
  (await db.query<{ result: Record<string, unknown> }>("select public.class_exercise_action($1, $2, $3, $4::jsonb) as result", [classId, actor, action, JSON.stringify(input)])).rows[0].result;
const publish = (id = randomUUID(), prompt = "Write a function.") => act("publish", { id, prompt, durationSeconds: 180 });
const submit = (questionId: unknown, actor = alice, answer = "def greet():\n    return 42\n") => act("submit", { id: randomUUID(), questionId, answer }, actor);

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.app_users(id uuid primary key);
    create table public.courses(id uuid primary key);
    create table public.course_classes(id uuid primary key, course_id uuid references public.courses);
    create table public.course_enrollments(id uuid primary key, course_id uuid references public.courses, student_id uuid references public.app_users);
  `);
  await db.exec(readFileSync("supabase/migrations/20260915010000_class_exercises.sql", "utf8"));
  await db.exec("grant all on all tables in schema public to anon, authenticated, service_role");
  for (const id of [tutor, alice, bob, outsider]) await db.query("insert into app_users values($1)", [id]);
  await db.query("insert into courses values($1)", [course]);
  for (const id of [lesson, otherClass]) await db.query("insert into course_classes values($1, $2)", [id, course]);
  for (const id of [alice, bob]) await db.query("insert into course_enrollments values($1,$2,$3)", [randomUUID(), course, id]);
}, 30000);
beforeEach(async () => { await db.exec("truncate class_exercise_rooms cascade"); });
afterAll(async () => { await db.close(); });

describe("class exercise PostgreSQL transactions", () => {
  it("preserves tabs, blank lines, leading spaces and trailing newlines", async () => {
    const prompt = "def solve():\n\t# Your code\n\n";
    const q = await publish(undefined, prompt);
    const answer = "  def solve():\n\tprint('hello')\n\n";
    const s = await submit(q.id, alice, answer);
    expect(q.prompt).toBe(prompt); expect(s.answer).toBe(answer); expect(s.attempt).toBe(1);
  });
  it("rejects non-enrolled actors and does not expose another student's retry", async () => {
    const q = await publish();
    await expect(submit(q.id, outsider)).rejects.toThrow("Enroll");
    const id = randomUUID();
    await act("submit", { id, questionId: q.id, answer: "private" }, alice);
    await expect(act("submit", { id, questionId: q.id, answer: "steal" }, bob)).rejects.toThrow("already in use");
  });
  it("requires incorrect feedback before resubmission and retains every attempt", async () => {
    const q = await publish();
    const first = await submit(q.id);
    await expect(submit(q.id)).rejects.toThrow("Wait for feedback");
    const marked = await act("grade", { submissionId: first.id, status: "incorrect", feedback: "Try:\n    return 42" });
    expect(marked.feedback).toBe("Try:\n    return 42");
    const second = await submit(q.id);
    expect(second.attempt).toBe(2);
    await expect(act("grade", { submissionId: first.id, status: "correct", feedback: "stale" })).rejects.toThrow("latest answer");
    await act("grade", { submissionId: second.id, status: "correct", feedback: "Well done" });
    await expect(submit(q.id)).rejects.toThrow("Wait for feedback");
    expect((await db.query("select * from class_exercise_submissions")).rows).toHaveLength(2);
  });
  it("freezes at stop and allows grading afterwards", async () => {
    const q = await publish(); const s = await submit(q.id);
    await act("stop", { questionId: q.id });
    await expect(submit(q.id, bob)).rejects.toThrow("closed");
    await act("grade", { submissionId: s.id, status: "incorrect", feedback: "Try next time" });
    await expect(submit(q.id)).rejects.toThrow("closed");
  });
  it("rejects submissions at the deadline using the DB clock", async () => {
    const q = await publish();
    await db.query("update class_exercise_questions set closes_at = clock_timestamp() where id = $1", [q.id]);
    await expect(submit(q.id)).rejects.toThrow("closed");
  });
  it("checks time after waiting, even inside a transaction begun before the deadline", async () => {
    const q = await publish();
    await db.query("update class_exercise_questions set closes_at = clock_timestamp() + interval '50 milliseconds' where id = $1", [q.id]);
    await db.exec("begin; select pg_sleep(0.08)");
    await expect(submit(q.id)).rejects.toThrow("closed");
    await db.exec("rollback");
  });
  it("replaces the question at the same class and rejects stale stops/submissions", async () => {
    const q = await publish(); const next = await publish();
    expect(next.number).toBe(2); expect(next.class_id).toBe(q.class_id);
    await expect(submit(q.id)).rejects.toThrow("closed");
    await expect(act("stop", { questionId: q.id })).rejects.toThrow("changed");
    expect((await submit(next.id)).question_id).toBe(next.id);
  });
  it("makes publish and submission retries idempotent, even after closing", async () => {
    const id = randomUUID(); const q = await publish(id);
    expect(await publish(id)).toEqual(q);
    const request = { id: randomUUID(), questionId: q.id, answer: "hello" };
    const s = await act("submit", request, alice);
    await act("stop", { questionId: q.id });
    expect(await act("submit", request, alice)).toEqual(s);
    const next = await publish();
    await publish(id);
    expect((await db.query<{ current_question_id: string }>("select current_question_id from class_exercise_rooms")).rows[0].current_question_id).toBe(next.id);
  });
  it("cannot mark a submission in another class", async () => {
    const q = await publish(); const s = await submit(q.id);
    await expect(act("grade", { submissionId: s.id, status: "correct", feedback: "" }, tutor, otherClass)).rejects.toThrow("not found");
  });
  it("serializes simultaneous submissions and stop-before-submit", async () => {
    const q = await publish();
    const results = await Promise.allSettled([submit(q.id), submit(q.id)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const results2 = await Promise.allSettled([act("stop", { questionId: q.id }), submit(q.id, bob)]);
    expect(results2[1].status).toBe("rejected");
  });
  it("claims one Discord announcement per class and permits retry after failure", async () => {
    await publish();
    const first = await act("claim_announcement", {});
    expect(first).toBeTruthy(); expect(await act("claim_announcement", {})).toBe(false);
    await act("finish_announcement", { claim: first, sent: false });
    const retry = await act("claim_announcement", {}); expect(retry).toBeTruthy();
    await act("finish_announcement", { claim: retry, sent: true });
    await publish(); expect(await act("claim_announcement", {})).toBe(false);
  });
  it("denies direct table reads/writes and RPC execution to public clients", async () => {
    const q = await publish(); await submit(q.id);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const table of ["class_exercise_rooms", "class_exercise_questions", "class_exercise_submissions"]) expect((await db.query(`select * from ${table}`)).rows).toEqual([]);
        await expect(publish()).rejects.toThrow("permission denied");
        await expect(db.query("insert into class_exercise_rooms(class_id) values($1)", [otherClass])).rejects.toThrow("row-level security");
      } finally { await db.exec("reset role"); }
    }
  });
});
