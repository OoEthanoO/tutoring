import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The course_feedback table's own guarantees (COURSE_FEEDBACK.md). */

const db = new PGlite();
const student = randomUUID(), course = randomUUID();
const migration = readFileSync("supabase/migrations/20261122120000_course_feedback.sql", "utf8");
const insert = (columns: Record<string, unknown>) => {
  const all = { course_id: course, student_id: student, ...columns };
  const keys = Object.keys(all);
  return db.query(
    `insert into course_feedback(${keys.join(", ")}) values (${keys.map((_, index) => `$${index + 1}`).join(", ")})`,
    Object.values(all)
  );
};

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key);
    create table courses(id uuid primary key, deleted_at timestamptz);
  `);
  // Applying it twice must work: the deploy may run a migration again.
  await db.exec(migration);
  await db.exec(migration);
  await db.query("insert into app_users values ($1)", [student]);
  await db.query("insert into courses(id) values ($1)", [course]);
}, 30000);
beforeEach(async () => { await db.exec("truncate course_feedback"); });
afterAll(async () => { await db.close(); });

describe("course_feedback", () => {
  it("keeps one row per student and course", async () => {
    await insert({ course_rating: 5 });
    await expect(insert({ course_rating: 4 })).rejects.toThrow();
  });

  it.each([
    [{ course_rating: 0 }], [{ tutor_rating: 6 }], [{ pace: "glacial" }], [{ another_course: "perhaps" }],
    [{ next_course: "x".repeat(201) }], [{ comments: "x".repeat(2001) }],
  ])("refuses %j", async (columns) => {
    await expect(insert(columns)).rejects.toThrow();
  });

  it("keeps No thanks free of answers", async () => {
    await insert({ declined_at: new Date().toISOString() });
    await expect(insert({ declined_at: new Date().toISOString(), course_rating: 3 })).rejects.toThrow();
  });

  it("goes with its course and its student", async () => {
    await insert({ comments: "Good" });
    await db.query("delete from courses where id = $1", [course]);
    expect((await db.query("select count(*)::int as n from course_feedback")).rows).toEqual([{ n: 0 }]);
    await db.query("insert into courses(id) values ($1)", [course]);
  });

  it("is closed to everyone but the service role, and marks invited courses", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'course_feedback'");
    expect(rows[0].relrowsecurity).toBe(true);
    await db.query("update courses set feedback_invited_at = now() where id = $1", [course]);
  });
});
