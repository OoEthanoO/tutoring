import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The email_log table's own guarantees (EMAIL.md). */

const db = new PGlite();
const migration = readFileSync("supabase/migrations/20261124120000_email_log.sql", "utf8");

beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  // Applying it twice must work: the deploy may run a migration again.
  await db.exec(migration);
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db.close(); });

describe("email_log", () => {
  it("numbers each email in the order it was sent", async () => {
    await db.query("insert into email_log(subject, status) values ('First', 'sent'), ('Second', 'failed')");
    const { rows } = await db.query<{ subject: string; to_addresses: string[] }>(
      "select subject, to_addresses from email_log order by id desc"
    );
    expect(rows).toEqual([
      { subject: "Second", to_addresses: [] },
      { subject: "First", to_addresses: [] },
    ]);
  });

  it("only knows sent and failed", async () => {
    await expect(db.query("insert into email_log(status) values ('bounced')")).rejects.toThrow();
    await expect(db.query("insert into email_log(subject) values ('No status')")).rejects.toThrow();
  });

  it("is closed to everyone but the service role", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'email_log'"
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
    const policies = await db.query<{ policyname: string; qual: string }>(
      "select policyname, qual from pg_policies where tablename = 'email_log'"
    );
    expect(policies.rows).toEqual([{ policyname: "Deny all access", qual: "false" }]);
  });
});
