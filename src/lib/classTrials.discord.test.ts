import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDiscordSync } from "./discordSync";
import { buildLiveVoicePermissionOverwrites } from "./discordLiveChannels";
import { getCourseTopicMarker } from "./discordSync";

vi.mock("@/lib/fundraising", () => ({ fetchFundraisingRaisedAmount: async () => 0 }));
type Row = Record<string, unknown>;
type Channel = { id: string; name: string; type: number; parent_id?: string; topic?: string; permission_overwrites?: { id: string; type: 0 | 1; allow: string; deny: string }[] };
type Member = { user: { id: string; username: string; bot?: boolean }; roles: string[]; nick?: string; mute?: boolean };
let tables: Record<string, Row[]>, channels: Channel[], members: Member[], roles: Row[];
let calls: { method: string; path: string; body: Row }[];
let failedTable: string | null;
let voice: Record<string, string | null>;
const start = new Date("2026-10-01T18:00:00Z");
const guest = "123456789012345678";

const db = () => ({ rpc: async () => ({ data: true, error: null }), from: (table: string) => {
  const filters: ((row: Row) => boolean)[] = [];
  let range: number[] | null = null, mode = "select", payload: Row = {};
  const run = () => {
    if (failedTable === table) return { data: null, error: { message: "database unavailable" } };
    const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
    if (mode === "insert" || mode === "upsert") {
      const all = tables[table] ??= [];
      if (mode === "insert" || !all.some(r => r.discord_channel_id === payload.discord_channel_id)) all.push(payload);
      return { data: [], error: null };
    }
    if (mode === "delete") { tables[table] = (tables[table] ?? []).filter(r => !rows.includes(r)); return { data: [], error: null }; }
    if (mode !== "select") { rows.forEach(r => Object.assign(r, payload)); return { data: [], error: null }; }
    return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
  };
  const q = {
    select: () => q, order: () => q, limit: () => q,
    range: (from: number, to: number) => { range = [from, to]; return q; },
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    not: () => q, in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    gt: () => q, lte: () => q,
    update: (p: Row) => { mode = "update"; payload = p; return q; },
    upsert: (p: Row) => { mode = "upsert"; payload = p; return q; },
    insert: (p: Row) => { mode = "insert"; payload = p; return q; },
    delete: () => { mode = "delete"; return q; },
    maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
    single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
    then: (resolve: (r: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
  }; return q;
} }) as unknown as SupabaseClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(start);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test"); vi.stubEnv("DISCORD_GUILD_ID", "guild");
  failedTable = null; calls = []; voice = {};
  const courses = ["a", "b"].map(id => ({ id, title: `Course ${id}`, created_by: "tutor", created_by_name: "Tutor Name", created_by_email: "tutor@example.test", is_completed: false,
    course_classes: [{ starts_at: start.toISOString(), duration_hours: 1 }], deleted_at: null }));
  tables = {
    app_users: [{ id: "tutor", email: "tutor@example.test", full_name: "Tutor Name", role: "executive", discord_user_id: "discord-tutor" }],
    courses, course_enrollments: [], approved_discord_accounts: [],
    class_trials: [{ id: "trial", class_id: "class-a", discord_user_id: guest, student_name: "Guest's Own Name", revoked_at: null,
      lesson: { id: "class-a", course_id: "a", title: "Class 1", starts_at: start.toISOString(), duration_hours: 1, course: courses[0] } }],
    discord_live_class_channels: ["a", "b"].map(id => ({ id, class_id: `class-${id}`, course_id: id, discord_channel_id: `live-${id}`, tutor_discord_user_id: "discord-tutor" })),
    discord_breakout_rooms: [{ id: "room", class_id: "class-a", live_channel_id: "live-a", discord_channel_id: "breakout-a", deleted_at: null }],
  };
  roles = [{ id: "guild", name: "@everyone", permissions: "0" }, ...["a", "b"].map(id => ({ id: `role-${id}`, name: `Course ${id}`, permissions: "0" }))];
  members = [{ user: { id: "discord-tutor", username: "teacher" }, roles: ["role-a", "role-b"] },
    { user: { id: guest, username: "visitor" }, nick: "Tutor Name", roles: ["role-a", "role-b"] }];
  channels = [{ id: "live-category", name: "Live", type: 4 }, { id: "courses-category", name: "Courses", type: 4 }];
  for (const id of ["a", "b"]) {
    const overwrites = buildLiveVoicePermissionOverwrites({ guildId: "guild", botUserId: "bot", tutorDiscordUserId: "discord-tutor", ceoRoleId: null, cooRoleId: null, courseRoleId: `role-${id}`, extraMemberDiscordUserIds: [guest] });
    channels.push({ id: `text-${id}`, name: `course-${id}`, type: 0, topic: getCourseTopicMarker(id), parent_id: "courses-category", permission_overwrites: overwrites },
      { id: `live-${id}`, name: `class-${id}`, type: 2, parent_id: "live-category", permission_overwrites: overwrites });
  }
  channels.push({ id: "breakout-a", name: "Breakout", type: 2, parent_id: "live-category", permission_overwrites: channels.find(c => c.id === "live-a")!.permission_overwrites });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace("/api/v10", "");
    const method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, path, body });
    const json = (data: unknown) => Response.json(structuredClone(data));
    if (method === "GET") {
      if (path === "/users/@me") return json({ id: "bot" });
      if (path === "/guilds/guild") return json({ owner_id: "owner" });
      if (path.endsWith("/members")) return json(members);
      if (path.endsWith("/roles")) return json(roles);
      if (path.endsWith("/channels")) return json(channels);
      if (path.includes("/voice-states/")) return voice[path.split("/").at(-1)!] ? json({ channel_id: voice[path.split("/").at(-1)!], mute: members.find(m => m.user.id === path.split("/").at(-1))?.mute ?? false }) : new Response(null, { status: 404 });
    }
    if (path.endsWith("/messages")) return json({});
    if (path === "/guilds/guild/roles" && method === "POST") { const role = { id: `new-role-${roles.length}`, permissions: "0", ...body }; roles.push(role); return json(role); }
    if (path === "/guilds/guild/channels" && method === "POST") { const channel = { id: `new-channel-${channels.length}`, ...body }; channels.push(channel); return json(channel); }
    if (path === "/guilds/guild/roles" && method === "PATCH") {
      for (const value of body) Object.assign(roles.find(r => r.id === value.id) ?? {}, value);
      return json(roles);
    }
    const roleMatch = path.match(/^\/guilds\/guild\/roles\/(.+)$/);
    if (roleMatch) { const role = roles.find(r => r.id === roleMatch[1]); if (method === "DELETE") roles = roles.filter(r => r !== role); else Object.assign(role ?? {}, body); return json(role ?? {}); }
    const channelMatch = path.match(/^\/channels\/(.+)$/);
    if (channelMatch) { const channel = channels.find(c => c.id === channelMatch[1]); if (method === "DELETE") channels = channels.filter(c => c !== channel); else Object.assign(channel ?? {}, body); return json(channel ?? {}); }
    const memberMatch = path.match(/^\/guilds\/guild\/members\/([^/]+)(?:\/roles\/(.+))?$/);
    if (memberMatch) {
      const member = members.find(m => m.user.id === memberMatch[1]);
      if (member && memberMatch[2]) member.roles = method === "DELETE" ? member.roles.filter(r => r !== memberMatch[2]) : [...member.roles, memberMatch[2]];
      else if (member && method === "PATCH") { Object.assign(member, body); if ("channel_id" in body) voice[memberMatch[1]] = body.channel_id; }
      else if (method === "DELETE") members = members.filter(m => m !== member);
      return json(member ?? {});
    }
    throw new Error(`Unstubbed Discord request: ${method} ${path}`);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const access = (id: string) => channels.find(c => c.id === id)?.permission_overwrites?.some(o => o.type === 1 && o.id === guest);
const sync = async () => { const result = await runDiscordSync({ adminClient: db() }); expect(result.errors).toEqual([]); };

describe("trial guests through the real guild sync", () => {
  it("keeps the guest's own name and only opens the selected class and its breakout rooms", async () => {
    await sync();
    expect(members.find(m => m.user.id === guest)?.nick).toBe("Guest's Own Name");
    expect(members.find(m => m.user.id === guest)?.roles).not.toContain("role-a");
    expect(members.find(m => m.user.id === guest)?.roles).not.toContain("role-b");
    expect(access("text-a")).toBe(true); expect(access("live-a")).toBe(true); expect(access("breakout-a")).toBe(true);
    expect(access("text-b")).toBe(false); expect(access("live-b")).toBe(false);
    expect(calls.some(c => c.method === "DELETE" && c.path === `/guilds/guild/members/${guest}`)).toBe(false);
  });
  it("allows early server joining without opening class access early", async () => {
    vi.setSystemTime(start.getTime() - 10 * 60_000); await sync();
    expect(members.some(m => m.user.id === guest)).toBe(true);
    expect(access("text-a")).toBe(false); expect(access("live-a")).toBe(false);
  });
  it("removes expired guest access and guest membership", async () => {
    vi.setSystemTime(start.getTime() + 90 * 60_000); await sync();
    expect(members.some(m => m.user.id === guest)).toBe(false);
    expect(access("text-a")).toBe(false); expect(access("live-a")).toBe(false); expect(access("breakout-a")).toBe(false);
  });
  it("keeps a regular enrollee's identity, membership and call after trial expiry", async () => {
    tables.app_users.push({ id: "student", email: "student@example.test", full_name: "Website Name", role: "student", discord_user_id: guest });
    tables.course_enrollments.push({ id: "enrollment", course_id: "a", student_id: "student" });
    voice[guest] = "live-a";
    vi.setSystemTime(start.getTime() + 90 * 60_000); await sync();
    expect(members.find(m => m.user.id === guest)?.nick).toBe("Website Name");
    expect(members.find(m => m.user.id === guest)?.roles).toContain("role-a");
    expect(voice[guest]).toBe("live-a");
  });
  it("disconnects revoked guests from the old call even if another future trial keeps them in the server", async () => {
    tables.class_trials[0].revoked_at = start.toISOString();
    const first = tables.class_trials[0];
    tables.class_trials.push({ ...first, id: "future", class_id: "later", revoked_at: null,
      lesson: { ...(first.lesson as Row), id: "later", starts_at: new Date(start.getTime() + 86400_000).toISOString() } });
    voice[guest] = "breakout-a"; await sync();
    expect(members.some(m => m.user.id === guest)).toBe(true); expect(voice[guest]).toBeNull();
    expect(access("breakout-a")).toBe(false);
  });
  it("aborts before any Discord mutation when the guest list cannot be loaded", async () => {
    failedTable = "class_trials";
    await expect(runDiscordSync({ adminClient: db() })).rejects.toThrow("database unavailable");
    expect(calls).toHaveLength(0);
  });
  it("withdraws guest access from an orphaned live channel after its class is deleted", async () => {
    tables.class_trials[0] = { ...tables.class_trials[0], class_id: null, lesson: null };
    tables.discord_live_class_channels = []; tables.discord_breakout_rooms = [];
    await sync();
    expect(access("live-a")).toBe(false); expect(access("breakout-a")).toBe(false);
    expect(channels.some(c => c.id === "live-a")).toBe(true);
  });
  it("withdraws expired trial grants while retaining a cancelled class's tracked voice channels", async () => {
    tables.class_trials[0] = { ...tables.class_trials[0], class_id: null, lesson: null };
    tables.discord_live_class_channels[0].class_id = null;
    tables.discord_breakout_rooms[0].class_id = null;
    await sync();
    expect(access("live-a")).toBe(false); expect(access("breakout-a")).toBe(false);
    expect(channels.some(c => c.id === "live-a")).toBe(true);
    expect(channels.some(c => c.id === "breakout-a")).toBe(true);
  });
  it("prefers narrow trial access over an approval read just before conversion", async () => {
    tables.approved_discord_accounts = [{ discord_user_id: guest, owner_user_id: "tutor" }];
    await sync();
    expect(members.find(m => m.user.id === guest)?.nick).toBe("Guest's Own Name");
    expect(members.find(m => m.user.id === guest)?.roles).not.toContain("role-b");
    expect(access("live-b")).toBe(false);
  });
  it("keeps a trial guest muted across repeated Zen syncs and preserves the bot's voice", async () => {
    tables.courses[0].zen_mode_enabled = true;
    members.push({ user: { id: "bot", username: "yanbot", bot: true }, roles: [] });
    voice[guest] = "breakout-a";
    await sync(); await sync();
    expect(members.find(m => m.user.id === guest)?.mute).toBe(true);
    for (const channelId of ["live-a", "breakout-a"]) {
      const overwrites = channels.find(c => c.id === channelId)!.permission_overwrites!;
      expect(BigInt(overwrites.find(o => o.id === guest)!.deny) & BigInt(2097152)).toBe(BigInt(2097152));
      expect(BigInt(overwrites.find(o => o.id === "bot")!.allow) & BigInt(2097152)).toBe(BigInt(2097152));
    }
    tables.courses[0].zen_mode_enabled = false;
    await sync();
    expect(members.find(m => m.user.id === guest)?.mute).toBe(false);
    expect(access("breakout-a")).toBe(true);
  });
});
