import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const tutor = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await db.exec(`
    create role authenticated;
    create table recorder_sessions (tutor_id uuid, device_id text, unique(tutor_id, device_id));
    insert into recorder_sessions values ('${tutor}', 'computer');
  `);
  await db.exec(readFileSync("supabase/migrations/20261008010000_recorder_diagnostics.sql", "utf8"));
  await db.exec(`grant select, insert, update, delete on recorder_diagnostics to authenticated;`);
}, 20000);
afterAll(async () => db.close());

describe("diagnostics storage", () => {
  it("does not allow website clients to read or write reports even with table grants", async () => {
    await db.query("insert into recorder_diagnostics(tutor_id, device_id, report) values ($1, 'computer', $2)", [tutor, { state: "idle" }]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select * from recorder_diagnostics")).rows).toEqual([]);
      await expect(db.query("insert into recorder_diagnostics(tutor_id, device_id, report) values ($1, 'computer', '{}')", [tutor])).rejects.toThrow(/row-level security/);
    } finally { await db.exec("reset role"); }
  });
  it("rejects unregistered devices and oversized reports at the database boundary", async () => {
    await expect(db.query("insert into recorder_diagnostics(tutor_id, device_id, report) values ($1, 'unknown', '{}')", [tutor])).rejects.toThrow(/foreign key/);
    await expect(db.query("update recorder_diagnostics set report = $1", [{ message: "x".repeat(200000) }])).rejects.toThrow(/check constraint/);
  });
  it("removes a report when its registered recorder session is deleted", async () => {
    await db.query("delete from recorder_sessions where tutor_id = $1", [tutor]);
    expect((await db.query("select * from recorder_diagnostics")).rows).toEqual([]);
  });
});
