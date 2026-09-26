import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.DISCORD_BOT_TOKEN = "token";
  process.env.DISCORD_GUILD_ID = "guild";
  return { admin: vi.fn() };
});
vi.mock("@/lib/authServer", () => ({ getAdminClient: mocks.admin }));

import { getBreakoutAccess, readBreakoutState, runBreakoutAction } from "./breakoutRoomsServer";
import type { SessionUser } from "@/lib/authServer";

const classId = "11111111-1111-4111-8111-111111111111";
const tutor = { id: "tutor", email: "tutor@example.test", role: "executive" } as SessionUser;
const stranger = { id: "someone", email: "x@example.test", role: "executive" } as SessionUser;

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failInsert = false;

/** Just enough of supabase-js's query builder for the module under test. */
const fakeDb = () => ({
  from: (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let head = false;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((test) => test(row)));
    const run = () => {
      if (mode === "insert") {
        if (failInsert) return { data: null, error: { message: "insert failed" } };
        const row = { id: `row-${(tables[table] ?? []).length + 1}`, deleted_at: null, ...payload };
        (tables[table] ??= []).push(row);
        return { data: [row], error: null };
      }
      if (mode === "update") {
        rows().forEach((row) => Object.assign(row, payload));
        return { data: [], error: null };
      }
      const found = rows();
      return { data: head ? null : found, count: found.length, error: null };
    };
    const query = {
      select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return query; },
      insert: (value: Row) => { mode = "insert"; payload = value; return query; },
      update: (value: Row) => { mode = "update"; payload = value; return query; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return query; },
      order: () => query,
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return query;
  },
});

/** Discord: which voice channel each account is in, and a log of every write. */
let voice: Record<string, string>;
let calls: { method: string; path: string; body?: Record<string, unknown> }[];
let nextRoom = 0;

const discordFetch = async (url: string, init: RequestInit) => {
  const path = url.replace("https://discord.com/api/v10", "");
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  if (method === "GET" && path === "/channels/live") {
    return json({ id: "live", parent_id: "live-category", permission_overwrites: [{ id: "course-role", type: 0, allow: "1049600", deny: "0" }] });
  }
  if (method === "POST" && path === "/guilds/guild/channels") {
    nextRoom += 1;
    return json({ id: `room-${nextRoom}` });
  }
  const voiceMatch = path.match(/^\/guilds\/guild\/voice-states\/(.+)$/);
  if (method === "GET" && voiceMatch) {
    const channel = voice[voiceMatch[1]];
    return channel ? json({ channel_id: channel }) : json({ message: "Unknown Voice State" }, 404);
  }
  const moveMatch = path.match(/^\/guilds\/guild\/members\/(.+)$/);
  if (method === "PATCH" && moveMatch) {
    voice[moveMatch[1]] = String(body?.channel_id);
    return json({});
  }
  if (method === "DELETE") {
    return json({});
  }
  return json({ message: "Not found" }, 404);
};

const students = ["ann", "ben", "cat", "dan", "eve"];

beforeEach(() => {
  failInsert = false;
  nextRoom = 0;
  calls = [];
  voice = { "discord-tutor": "live", ...Object.fromEntries(students.map((name) => [`discord-${name}`, "live"])) };
  tables = {
    course_classes: [{
      id: classId, title: "Class 3", starts_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      course: { id: "course", title: "Grade 6 French", created_by: "tutor", co_tutor_id: null, deleted_at: null },
    }],
    discord_live_class_channels: [{ class_id: classId, discord_channel_id: "live", deleted_at: null }],
    course_enrollments: students.map((name) => ({
      course_id: "course", student_id: name,
      student: { full_name: name.toUpperCase(), email: `${name}@example.test`, discord_user_id: `discord-${name}` },
    })),
    app_users: [{ id: "tutor", full_name: "Tutor", discord_user_id: "discord-tutor" }],
    approved_discord_accounts: [],
    discord_breakout_rooms: [],
  };
  mocks.admin.mockReturnValue(fakeDb());
  vi.stubGlobal("fetch", vi.fn(discordFetch));
});
afterEach(() => { vi.unstubAllGlobals(); });

const access = () => getBreakoutAccess(tutor, classId);

describe("breakout rooms against Discord", () => {
  it("only lets the course's tutors and the trio run the rooms", async () => {
    await expect(getBreakoutAccess(stranger, classId)).rejects.toMatchObject({ status: 403 });
  });

  it("opens rooms that copy the class channel's access and category", async () => {
    await runBreakoutAction(await access(), { action: "open", count: 2, split: false });
    const created = calls.filter((call) => call.method === "POST");
    expect(created.map((call) => call.body?.name)).toEqual(["Room 1 · Grade 6 French", "Room 2 · Grade 6 French"]);
    for (const call of created) {
      expect(call.body?.parent_id).toBe("live-category");
      expect(call.body?.permission_overwrites).toEqual([{ id: "course-role", type: 0, allow: "1049600", deny: "0" }]);
    }
    expect(tables.discord_breakout_rooms.map((row) => row.discord_channel_id)).toEqual(["room-1", "room-2"]);
  });

  it("splits the students in the call evenly and leaves the tutor where they are", async () => {
    await runBreakoutAction(await access(), { action: "open", count: 2, split: true });
    const placed = students.map((name) => voice[`discord-${name}`]);
    const sizes = ["room-1", "room-2"].map((room) => placed.filter((channel) => channel === room).length).sort();
    expect(sizes).toEqual([2, 3]);
    expect(voice["discord-tutor"]).toBe("live");
  });

  it("does not pull in a student who is not in the class", async () => {
    voice["discord-eve"] = "some-other-channel";
    await runBreakoutAction(await access(), { action: "open", count: 2, split: true });
    expect(voice["discord-eve"]).toBe("some-other-channel");
  });

  it("deletes a room it could not save, so nothing untracked is left in Live", async () => {
    failInsert = true;
    await expect(runBreakoutAction(await access(), { action: "open", count: 1, split: false })).rejects.toThrow();
    expect(calls.some((call) => call.method === "DELETE" && call.path === "/channels/room-1")).toBe(true);
  });

  it("brings everyone back before deleting the rooms", async () => {
    await runBreakoutAction(await access(), { action: "open", count: 2, split: true });
    voice["discord-tutor"] = "room-1";
    calls = [];
    await runBreakoutAction(await access(), { action: "close" });
    expect(Object.values(voice).every((channel) => channel === "live")).toBe(true);
    const lastMove = calls.map((call) => call.method).lastIndexOf("PATCH");
    const firstDelete = calls.map((call) => call.method).indexOf("DELETE");
    expect(lastMove).toBeLessThan(firstDelete);
    expect(tables.discord_breakout_rooms.every((row) => row.deleted_at)).toBe(true);
  });

  it("reports who is where", async () => {
    await runBreakoutAction(await access(), { action: "open", count: 1, split: false });
    voice["discord-ann"] = "room-1";
    delete voice["discord-ben"];
    const state = await readBreakoutState(await access());
    expect(state.rooms[0].students).toEqual(["ANN"]);
    expect(state.notInCall).toEqual(["BEN"]);
    expect(state.inMainRoom.sort()).toEqual(["CAT", "DAN", "EVE"]);
  });

  it("refuses to open rooms before students are let in", async () => {
    tables.course_classes[0].starts_at = new Date(Date.now() + 10 * 60_000).toISOString();
    await expect(runBreakoutAction(await access(), { action: "open", count: 1, split: false }))
      .rejects.toMatchObject({ status: 409 });
  });
});
