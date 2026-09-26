import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const actor = randomUUID(), owner = randomUUID(), course = randomUUID(), lesson = randomUUID();
const discord = "123456789012345678";
const save = (replace: string | null = null, name = "Trial Student") => db.query(
  "select save_class_trial($1,$2,$3,$4,$5) as id", [lesson, discord, name, actor, replace]);
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key);
    create table courses(id uuid primary key, deleted_at timestamptz, is_completed boolean default false);
    create table course_classes(id uuid primary key, course_id uuid references courses, starts_at timestamptz, duration_hours numeric);
    create table approved_discord_accounts(discord_user_id text primary key, owner_user_id uuid references app_users);
  `);
  await db.exec(readFileSync("supabase/migrations/20260926160000_create_class_trials.sql", "utf8"));
  await db.exec("grant all on all tables in schema public to anon, authenticated, service_role");
  await db.query("insert into app_users values ($1),($2)", [actor, owner]);
  await db.query("insert into courses(id) values($1)", [course]);
  await db.query("insert into course_classes values($1,$2,now() + interval '1 hour',1)", [lesson, course]);
}, 30000);
beforeEach(async () => {
  await db.exec("truncate class_trials, approved_discord_accounts");
  await db.query("update course_classes set starts_at = now() + interval '1 hour' where id=$1", [lesson]);
});
afterAll(async () => { await db.close(); });

describe("trial booking database", () => {
  it("books without a student website account and deduplicates repeat booking", async () => {
    const first = await save(); const second = await save();
    expect(first.rows).toEqual(second.rows);
    expect((await db.query("select * from class_trials")).rows).toHaveLength(1);
  });
  it("atomically converts an approved extra account only for the expected owner", async () => {
    await db.query("insert into approved_discord_accounts values($1,$2)", [discord, owner]);
    await expect(save()).rejects.toThrow("Confirm replacement");
    await expect(save(actor)).rejects.toThrow("Confirm replacement");
    await expect(save(owner, "")).rejects.toThrow();
    expect((await db.query("select * from approved_discord_accounts")).rows).toHaveLength(1);
    await save(owner);
    expect((await db.query("select * from approved_discord_accounts")).rows).toHaveLength(0);
    expect((await db.query("select * from class_trials")).rows).toHaveLength(1);
  });
  it("prevents a trial identity simultaneously becoming a tutor alias", async () => {
    await save();
    await expect(db.query("insert into approved_discord_accounts values($1,$2)", [discord, owner])).rejects.toThrow("trial booking");
    await db.exec("update class_trials set revoked_at = now()");
    await db.query("insert into approved_discord_accounts values($1,$2)", [discord, owner]);
    await expect(db.exec("update class_trials set revoked_at = null")).rejects.toThrow("tutor-linked approval");
  });
  it("refuses expired classes using the database clock", async () => {
    await db.query("update course_classes set starts_at=now() - interval '2 hours' where id=$1", [lesson]);
    await expect(save()).rejects.toThrow("upcoming or currently running");
  });
  it("denies browser roles direct writes and access to the privileged function", async () => {
    await save();
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select * from class_trials")).rows).toHaveLength(0);
      await expect(save()).rejects.toThrow("permission denied");
      await expect(db.query("insert into class_trials(class_id, discord_user_id, student_name) values($1,'999999999999999999','Guest')", [lesson])).rejects.toThrow();
    } finally { await db.exec("reset role"); }
  });
  it("retains the guest identity for cleanup when the class is deleted", async () => {
    await save(); await db.exec("begin");
    try {
      await db.query("delete from course_classes where id=$1", [lesson]);
      expect((await db.query("select class_id, discord_user_id from class_trials")).rows).toEqual([{ class_id: null, discord_user_id: discord }]);
    } finally { await db.exec("rollback"); }
  });
  it("reserves channel permission capacity across the course's trial bookings", async () => {
    await db.query("insert into class_trials(class_id, discord_user_id, student_name) select $1, (800000000000000000 + n)::text, 'Guest' from generate_series(1,80) n", [lesson]);
    await expect(save()).rejects.toThrow("80 trial students");
    await db.exec("update class_trials set revoked_at=now() where discord_user_id='800000000000000001'");
    await save();
  });
  it("allows deleting an expired class after its guest becomes a tutor extra account", async () => {
    await save();
    await db.query("update course_classes set starts_at=now() - interval '2 hours' where id=$1", [lesson]);
    await db.query("insert into approved_discord_accounts values($1,$2)", [discord, owner]);
    await db.exec("begin");
    try {
      await db.query("delete from course_classes where id=$1", [lesson]);
      expect((await db.query("select class_id from class_trials")).rows).toEqual([{ class_id: null }]);
      expect((await db.query("select owner_user_id from approved_discord_accounts")).rows).toEqual([{ owner_user_id: owner }]);
    } finally { await db.exec("rollback"); }
  });
});
