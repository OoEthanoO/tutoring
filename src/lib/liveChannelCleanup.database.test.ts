import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const course = "11111111-1111-4111-8111-111111111111";
const lesson = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create function auth.role() returns text language sql as $$ select current_user::text $$;
    create table app_users(id uuid primary key);
    create table courses(id uuid primary key);
    create table course_classes(id uuid primary key, course_id uuid references courses on delete cascade,
      starts_at timestamptz not null, duration_hours numeric not null);
  `);
  for (const file of [
    "20260517_create_discord_live_class_channels.sql",
    "20260730210000_add_empty_since_to_live_class_channels.sql",
    "20260913010000_live_channel_cleanup_safety.sql",
    "20260926120000_create_discord_breakout_rooms.sql",
    "20261007210000_preserve_deleted_class_voice_channels.sql",
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate courses, course_classes, discord_live_class_channels, discord_breakout_rooms cascade");
  await db.query("insert into courses values($1)", [course]);
  await db.query("insert into course_classes values($1,$2,'2026-10-05 20:00:00-04',1)", [lesson, course]);
  await db.query(`insert into discord_live_class_channels(class_id,course_id,discord_channel_id,tutor_discord_user_id,starts_at,ends_at,empty_since,tutor_absent_since)
    values($1,$2,'voice','tutor','2026-10-05 20:00:00-04','2026-10-05 21:00:00-04',now(),now())`, [lesson, course]);
  await db.query(`insert into discord_breakout_rooms(class_id,live_channel_id,discord_channel_id,number)
    values($1,'voice','room',1)`, [lesson]);
});
afterAll(async () => { await db.close(); });

describe("deleted class channel retention", () => {
  it("keeps the main channel and breakout rooms tracked when a class is deleted", async () => {
    await db.query("delete from course_classes where id=$1", [lesson]);
    expect((await db.query("select class_id,course_id,discord_channel_id,empty_since,tutor_absent_since from discord_live_class_channels")).rows)
      .toEqual([{ class_id: null, course_id: course, discord_channel_id: "voice", empty_since: null, tutor_absent_since: null }]);
    expect((await db.query("select class_id,live_channel_id,discord_channel_id from discord_breakout_rooms")).rows)
      .toEqual([{ class_id: null, live_channel_id: "voice", discord_channel_id: "room" }]);
  });
  it("captures a just-extended schedule before deletion, even before the next cron tick", async () => {
    await db.query("update course_classes set starts_at='2026-10-05 20:15:00-04',duration_hours=2 where id=$1", [lesson]);
    await db.query("delete from course_classes where id=$1", [lesson]);
    const { rows } = await db.query<{ start: number; finish: number }>("select extract(epoch from starts_at)::double precision as start, extract(epoch from ends_at)::double precision as finish from discord_live_class_channels");
    expect(rows[0]).toEqual({ start: Date.parse("2026-10-05T20:15:00-04:00") / 1000, finish: Date.parse("2026-10-05T22:15:00-04:00") / 1000 });
  });
  it("retains channels and their schedule even after a permanent course deletion", async () => {
    await db.query("delete from courses where id=$1", [course]);
    expect((await db.query("select class_id,course_id,discord_channel_id from discord_live_class_channels")).rows)
      .toEqual([{ class_id: null, course_id: null, discord_channel_id: "voice" }]);
    expect((await db.query("select live_channel_id from discord_breakout_rooms")).rows).toEqual([{ live_channel_id: "voice" }]);
  });
  it("retains an invalid duration conservatively rather than inventing an end", async () => {
    await db.query("update course_classes set duration_hours=0 where id=$1", [lesson]);
    await db.query("delete from course_classes where id=$1", [lesson]);
    expect((await db.query("select ends_at::text from discord_live_class_channels")).rows).toEqual([{ ends_at: "infinity" }]);
  });
});
