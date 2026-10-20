// Runs representative supabase-js reads (the shapes the app sends) against two
// PostgREST endpoints and reports, per query, whether the results match. Used
// by deploy/windows/db-restore.ps1 while moving off hosted Supabase. The source
// is only read: any method but GET/HEAD against it throws. Prints fingerprints
// and row counts, never row data.
//
//   YANLEARN_APP_DIR         folder whose node_modules has @supabase/supabase-js
//   SOURCE_URL, SOURCE_KEY   hosted Supabase
//   TARGET_URL, TARGET_KEY   the self-hosted gateway
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.env.YANLEARN_APP_DIR ?? process.cwd(), "package.json"));
const { createClient } = require("@supabase/supabase-js");

const readOnlyFetch = (input, init = {}) => {
  const method = String(init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return Promise.reject(new Error(`Refusing ${method} against the source database.`));
  }
  return fetch(input, init);
};

const connect = (url, key, fetchImpl) =>
  createClient(url, key, { auth: { persistSession: false }, global: { fetch: fetchImpl } });
const source = connect(process.env.SOURCE_URL, process.env.SOURCE_KEY, readOnlyFetch);
const target = connect(process.env.TARGET_URL, process.env.TARGET_KEY, fetch);

// Key order and row order normalised, so only content decides a match.
const canonical = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 12);

const firstCreator = async (db) => {
  const { data } = await db.from("courses").select("created_by").not("created_by", "is", null).order("id").limit(1);
  return data?.[0]?.created_by ?? "00000000-0000-0000-0000-000000000000";
};

const queries = {
  "courses + embedded counts": (db) => db.from("courses")
    .select("id, title, max_students, course_classes(starts_at), course_enrollments(count)").order("id"),
  "classes + !inner course": (db) => db.from("course_classes")
    .select("id, course_id, starts_at, course:courses!inner(created_by, created_by_email)").order("id").limit(1000),
  "course requests + FK-name hints": (db) => db.from("course_creation_requests")
    .select("id, status, app_users!course_creation_requests_created_by_fkey(full_name, email, discord_user_id), co_tutor:app_users!course_creation_requests_co_tutor_id_fkey(full_name)")
    .order("id"),
  "enrollments + column hint": (db) => db.from("course_enrollments")
    .select("student_id, student:app_users!student_id(full_name, email, discord_user_id)").order("student_id").limit(1000),
  "users + custom roles": (db) => db.from("app_users")
    .select("id, email, role, custom_role, custom_roles(role_level, name)").order("id"),
  "count exact, head": async (db) => {
    const { count, error } = await db.from("course_enrollments").select("student_id", { count: "exact", head: true });
    return { data: { count }, error };
  },
  "or() on creator/co-tutor": async (db) => {
    const id = await firstCreator(source);
    return db.from("courses").select("id").or(`created_by.eq.${id},co_tutor_id.eq.${id}`).order("id");
  },
  "ilike": (db) => db.from("courses").select("id").ilike("title", "%a%").order("id"),
  "not is null": (db) => db.from("course_classes").select("id").not("starts_at", "is", null).order("id").limit(1000),
  "max rows cap (asks for 2000)": (db) => db.from("class_attendance").select("id").order("id").range(0, 1999),
  "second page": (db) => db.from("class_reminder_logs").select("*").order("id").range(1000, 1999),
  "maybeSingle site settings": (db) => db.from("site_settings").select("*").eq("id", true).maybeSingle(),
  "deny-all table via service role": async (db) => {
    const { count, error } = await db.from("app_sessions").select("id", { count: "exact", head: true });
    return { data: { count }, error };
  },
};

// Rows written every minute by the reminders tick or by logins only match
// while writes are frozen.
const volatile = new Set(["second page", "deny-all table via service role", "max rows cap (asks for 2000)"]);

let mismatches = 0;
for (const [name, run] of Object.entries(queries)) {
  const [a, b] = await Promise.all([run(source), run(target)]);
  const rows = (result) => (Array.isArray(result.data) ? `${result.data.length} rows` : result.data ? "1 value" : "null");
  let verdict;
  if (a.error || b.error) {
    const same = a.error && b.error && a.error.code === b.error.code;
    verdict = same ? `same error ${a.error.code}` : `ERROR source=${a.error?.code ?? "ok"} target=${b.error?.code ?? "ok"} ${b.error?.message ?? a.error?.message ?? ""}`;
    if (!same) mismatches += 1;
  } else if (fingerprint(a.data) === fingerprint(b.data)) {
    verdict = `match (${rows(b)})`;
  } else {
    verdict = `DIFFERENT source=${rows(a)} target=${rows(b)}${volatile.has(name) ? " (changes while live)" : ""}`;
    if (!volatile.has(name) || process.env.COMPARE_STRICT === "1") mismatches += 1;
  }
  console.log(`${name.padEnd(34)} ${verdict}`);
}
console.log(mismatches ? `${mismatches} unexplained difference(s)` : "all queries match");
process.exitCode = mismatches ? 1 : 0;
