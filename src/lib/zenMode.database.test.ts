import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table courses(id uuid primary key); insert into courses values('11111111-1111-4111-8111-111111111111')");
  await db.exec(readFileSync("supabase/migrations/20260926180000_add_course_zen_mode.sql", "utf8"));
  await db.exec("grant all on all tables in schema public to anon, authenticated, service_role");
}, 30000);
afterAll(async () => { await db.close(); });
describe("Zen mode migration", () => {
  it("defaults existing courses to off", async () => {
    expect((await db.query("select zen_mode_enabled from courses")).rows).toEqual([{ zen_mode_enabled: false }]);
  });
  it("serializes workers, prevents another worker releasing the lease and recovers after expiry", async () => {
    expect((await db.query("select claim_zen_mode_sync($1) as claimed", [a])).rows).toEqual([{ claimed: true }]);
    expect((await db.query("select claim_zen_mode_sync($1) as claimed", [b])).rows).toEqual([{ claimed: false }]);
    await db.query("select release_zen_mode_sync($1)", [b]);
    expect((await db.query("select claim_zen_mode_sync($1) as claimed", [b])).rows).toEqual([{ claimed: false }]);
    await db.exec("update discord_zen_sync_lock set expires_at=now()-interval '1 second'");
    expect((await db.query("select claim_zen_mode_sync($1) as claimed", [b])).rows).toEqual([{ claimed: true }]);
    await db.query("select release_zen_mode_sync($1)", [b]);
  });
  it("blocks direct browser access to mute ownership and locking", async () => {
    await db.exec("insert into discord_zen_mutes(discord_user_id) values('123456789012345678'); set role authenticated");
    try {
      expect((await db.query("select * from discord_zen_mutes")).rows).toEqual([]);
      await expect(db.query("select claim_zen_mode_sync($1)", [a])).rejects.toThrow("permission denied");
      await expect(db.exec("insert into discord_zen_mutes(discord_user_id) values('999999999999999999')")).rejects.toThrow();
    } finally { await db.exec("reset role"); }
  });
});
