import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getRequestUser: mocks.user, getAdminClient: mocks.admin }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.admin }));
vi.mock("@/lib/notificationsServer", () => ({ sendDiscordMessageByChannelName: vi.fn() }));
vi.mock("@/lib/discordSync", () => ({ fetchDiscordGuildMemberIds: async () => new Set() }));

let route: typeof import("./route");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  route = await import("./route");
});
afterEach(() => { vi.clearAllMocks(); });

/** Supabase caps each response at this many rows, like a default project. */
const serverRowCap = 1000;
const accountCount = 2300;

type Row = Record<string, unknown>;
const pad = (n: number) => String(n).padStart(5, "0");
const accounts: Row[] = Array.from({ length: accountCount }, (_, index) => ({
  id: `user-${pad(index)}`,
  email: `person${index}@example.test`,
  full_name: `Person ${index}`,
  role: index % 10 === 0 ? "executive" : "student",
  // Everyone verified except the last hundred.
  email_verified_at: index < accountCount - 100 ? "2026-01-01T00:00:00Z" : null,
  created_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  school: index % 3 === 0 ? `School ${index % 7}` : null,
}));
const tables: Record<string, Row[]> = {
  app_users: accounts,
  tutor_profiles: accounts.filter((_, index) => index % 10 === 0).map((row) => ({ user_id: row.id, donation_link: "https://give" })),
  // The oldest account teaches; before the fix it fell outside the newest 200.
  courses: [{ id: "course-1", created_by: "user-00000", co_tutor_id: null, deleted_at: null, course_classes: [] }],
  course_enrollments: [],
};

let largestInList = 0;
const fakeDb = () => ({
  from: (table: string) => {
    const tests: ((row: Row) => boolean)[] = [];
    let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const run = () => {
      const matching = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
      const [from, to] = range;
      return { data: matching.slice(from, Math.min(to + 1, from + serverRowCap)), error: null };
    };
    const query = {
      select: () => query,
      order: () => query,
      ilike: () => query,
      eq: (key: string, value: unknown) => { tests.push((row) => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { tests.push((row) => row[key] !== value); return query; },
      is: (key: string, value: unknown) => { tests.push((row) => (row[key] ?? null) === value); return query; },
      not: (key: string) => { tests.push((row) => (row[key] ?? null) !== null); return query; },
      in: (key: string, values: unknown[]) => {
        largestInList = Math.max(largestInList, values.length);
        tests.push((row) => values.includes(row[key]));
        return query;
      },
      range: (from: number, to: number) => { range = [from, to]; return query; },
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return query;
  },
});

const list = async (query = "") => {
  mocks.user.mockResolvedValue({ id: "founder", email: "founder@example.test", role: "founder" });
  mocks.admin.mockReturnValue(fakeDb());
  const response = await route.GET(new NextRequest(`https://example.test/api/admin/users${query}`));
  expect(response.status).toBe(200);
  return response.json();
};

describe("admin users list", () => {
  it("returns every account, past both the old 200 limit and Supabase's row cap", async () => {
    const data = await list("?all=true");
    expect(data.users).toHaveLength(accountCount);
    expect(new Set(data.users.map((user: Row) => user.id)).size).toBe(accountCount);
  });

  it("still returns only verified accounts by default", async () => {
    const data = await list();
    expect(data.users).toHaveLength(accountCount - 100);
    expect(data.users.every((user: Row) => user.emailVerified)).toBe(true);
  });

  it("fills in details for accounts far down the list, not just the first page", async () => {
    const data = await list("?all=true");
    const oldest = data.users.find((user: Row) => user.id === "user-00000");
    expect(oldest.teachesCourse).toBe(true);
    const donor = data.users.find((user: Row) => user.id === `user-${pad(2200)}`);
    expect(donor.donationLink).toBe("https://give");
  });

  it("never puts more ids in one request than fit in a URL", async () => {
    largestInList = 0;
    await list("?all=true");
    expect(largestInList).toBeGreaterThan(0);
    expect(largestInList).toBeLessThanOrEqual(150);
  });

  it("lists schools from every account", async () => {
    mocks.user.mockResolvedValue({ id: "founder", email: "founder@example.test", role: "founder" });
    mocks.admin.mockReturnValue(fakeDb());
    const response = await route.GET(new NextRequest("https://example.test/api/admin/users?schools=true"));
    const data = await response.json();
    expect(data.schools).toHaveLength(7);
  });
});
