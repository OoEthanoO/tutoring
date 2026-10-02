import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareZenVoice, reconcileZenMode, syncZenMode, ZenBusyError } from "./zenModeServer";
import { buildLiveVoicePermissionOverwrites } from "./discordLiveChannels";
import { speakBit } from "./zenMode";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failTable: string | null;
const rpc = vi.fn();
const db = { rpc, from: (table: string) => {
  let mode = "read", payload: Row = {}, ignore = false;
  const filters: ((r: Row) => boolean)[] = [];
  let bounds: number[] | null = null;
  const run = () => {
    if (table === failTable) return { data: null, error: { message: "Database unavailable" } };
    const all = tables[table] ??= [], rows = all.filter(r => filters.every(f => f(r)));
    if (mode === "insert") all.push(payload);
    if (mode === "upsert" && (!ignore || !all.some(r => r.discord_channel_id === payload.discord_channel_id))) all.push(payload);
    if (mode === "delete") tables[table] = all.filter(r => !rows.includes(r));
    if (mode === "update") rows.forEach(r => Object.assign(r, payload));
    return { data: bounds ? rows.slice(bounds[0], bounds[1] + 1) : rows, error: null };
  };
  const q = {
    select: () => q, order: () => q,
    range: (from: number, to: number) => { bounds = [from, to]; return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    insert: (p: Row) => { mode = "insert"; payload = p; return q; },
    upsert: (p: Row, options: { ignoreDuplicates: boolean }) => { mode = "upsert"; payload = p; ignore = options.ignoreDuplicates; return q; },
    update: (p: Row) => { mode = "update"; payload = p; return q; },
    delete: () => { mode = "delete"; return q; },
    then: (resolve: (r: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
  }; return q;
} } as unknown as SupabaseClient;
const normal = () => buildLiveVoicePermissionOverwrites({ guildId: "guild", botUserId: "bot", tutorDiscordUserId: "teacher", ceoRoleId: null,
  cooRoleId: null, extraMemberDiscordUserIds: ["teacher-extra"], trialDiscordUserIds: ["trial"], courseRoleId: "course-role" });
let channels: { id: string; type: number; permission_overwrites: ReturnType<typeof normal> }[];
let voice: Record<string, { channel_id: string; mute: boolean }>;
let writes: { path: string; body: Row }[];
let failDiscord: boolean;
const call = vi.fn(async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  if (method === "GET") {
    if (path.endsWith("/channels")) return structuredClone(channels) as T;
    if (path.endsWith("/roles")) return [{ id: "guild", permissions: "0" }, { id: "course-role", permissions: "0" }] as T;
    if (path.includes("/members?")) return ["student", "moderated", "trial", "teacher", "teacher-extra", "co-teacher", "manager"].map(id => ({ user: { id }, roles: id === "trial" ? [] : ["course-role"] })).concat([{ user: { id: "bot", bot: true }, roles: [] }] as never) as T;
    if (path.includes("/members/")) return { user: { id: path.split("/").at(-1)! }, roles: ["course-role"] } as T;
    if (path.includes("/voice-states/")) return structuredClone(voice[path.split("/").at(-1)!] ?? null) as T;
  }
  if (method === "PATCH") {
    if (failDiscord) throw new Error("Missing Permissions");
    const value = body as Row; writes.push({ path, body: value });
    if (path.startsWith("/channels/")) Object.assign(channels.find(c => c.id === path.split("/").at(-1))!, value);
    else Object.assign(voice[path.split("/").at(-1)!], value);
    return {} as T;
  }
  throw new Error(`Unexpected ${method} ${path}`);
}) as Parameters<typeof reconcileZenMode>[1];
beforeEach(() => {
  vi.clearAllMocks(); failTable = null; failDiscord = false; writes = [];
  rpc.mockResolvedValue({ data: true, error: null });
  tables = {
    courses: [{ id: "course", zen_mode_enabled: true, created_by: "owner", co_tutor_id: "co", deleted_at: null }],
    app_users: [{ id: "owner", role: "executive", email: "owner@example.test", discord_user_id: "teacher" },
      { id: "co", role: "executive", email: "co@example.test", discord_user_id: "co-teacher" },
      { id: "manager", role: "student", custom_roles: [{ role_level: "CEO Shadow" }], email: "manager@example.test", discord_user_id: "manager" }],
    approved_discord_accounts: [{ discord_user_id: "teacher-extra", owner_user_id: "owner" }],
    discord_live_class_channels: [{ id: "live", class_id: "lesson", course_id: "course", discord_channel_id: "live" }],
    discord_breakout_rooms: [{ id: "room", class_id: "lesson", discord_channel_id: "breakout" }],
    discord_zen_channels: [], discord_zen_mutes: [],
  };
  channels = ["live", "breakout", "other"].map(id => ({ id, type: 2, permission_overwrites: normal() }));
  voice = Object.fromEntries(["student", "moderated", "teacher", "teacher-extra", "co-teacher", "manager"].map(id => [id, { channel_id: "live", mute: id === "moderated" }]));
  voice.trial = { channel_id: "breakout", mute: false };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Zen Discord reconciliation", () => {
  it("immediately handles a joining student without scanning or changing the guild", async () => {
    expect(await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true })).toEqual([]);
    expect(voice.student.mute).toBe(true);
    expect(writes).toEqual([{ path: "/guilds/guild/members/student", body: { mute: true } }]);
    expect(call).not.toHaveBeenCalledWith("GET", "/guilds/guild/members?limit=1000");
    expect(call).not.toHaveBeenCalledWith("GET", "/guilds/guild/channels");
    expect(voice.trial.mute).toBe(false);
  });
  it("uses the member's current room for delayed events, and preserves moderation mutes", async () => {
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    voice.student.channel_id = "other";
    voice.moderated.channel_id = "other";
    await reconcileZenMode(db, call, "guild", { memberIds: ["student", "moderated"], voicesOnly: true });
    expect(voice.student.mute).toBe(false);
    expect(voice.moderated.mute).toBe(true);
    expect(tables.discord_zen_mutes).toEqual([]);
  });
  it("keeps students muted between Zen rooms and restores them on joining a non-Zen class", async () => {
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    voice.student.channel_id = "breakout";
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    expect(voice.student.mute).toBe(true);
    tables.courses.push({ id: "normal-course", zen_mode_enabled: false });
    tables.discord_live_class_channels.push({ class_id: "other-lesson", course_id: "normal-course", discord_channel_id: "other" });
    voice.student.channel_id = "other";
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    expect(voice.student.mute).toBe(false);
  });
  it("retains disconnected members' mute ownership through empty Gateway snapshots and restart", async () => {
    await reconcileZenMode(db, call, "guild");
    delete voice.student;
    tables.courses[0].zen_mode_enabled = false;
    await reconcileZenMode(db, call, "guild", { memberIds: [], voicesOnly: false });
    expect(tables.discord_zen_mutes.map(r => r.discord_user_id)).toContain("student");
    voice.student = { channel_id: "other", mute: true };
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    expect(voice.student.mute).toBe(false);
    expect(tables.discord_zen_mutes.map(r => r.discord_user_id)).not.toContain("student");
    expect(tables.discord_zen_mutes.map(r => r.discord_user_id)).toContain("trial");
  });
  it("unmutes current students during the toggle's reconciliation without waiting for a voice event", async () => {
    await reconcileZenMode(db, call, "guild");
    tables.courses[0].zen_mode_enabled = false;
    await reconcileZenMode(db, call, "guild", { memberIds: ["student", "trial", "moderated"] });
    expect(voice.student.mute).toBe(false);
    expect(voice.trial.mute).toBe(false);
    expect(voice.moderated.mute).toBe(true);
    expect(channels[0].permission_overwrites).toEqual(normal());
  });
  it("handles a class-wide event burst with one roster request and no offline voice scans", async () => {
    await reconcileZenMode(db, call, "guild", { memberIds: ["student", "trial", "teacher", "manager"], voicesOnly: true });
    expect(voice.student.mute).toBe(true);
    expect(voice.trial.mute).toBe(true);
    expect(voice.teacher.mute).toBe(false);
    expect(call).toHaveBeenCalledWith("GET", "/guilds/guild/members?limit=1000");
    expect(call).not.toHaveBeenCalledWith("GET", "/guilds/guild/voice-states/moderated");
  });
  it("does not remove channel snapshots during a voice-only update", async () => {
    await reconcileZenMode(db, call, "guild");
    const saved = structuredClone(tables.discord_zen_channels);
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    expect(tables.discord_zen_channels).toEqual(saved);
  });
  it("retains ownership after an unmute fails so the worker can retry", async () => {
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    voice.student.channel_id = "other";
    failDiscord = true;
    expect(await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true })).toEqual(["Missing Permissions"]);
    expect(tables.discord_zen_mutes).toHaveLength(1);
    failDiscord = false;
    await reconcileZenMode(db, call, "guild", { memberIds: ["student"], voicesOnly: true });
    expect(voice.student.mute).toBe(false);
    expect(tables.discord_zen_mutes).toEqual([]);
  });
  it("mutes current students and trial guests, protects tutors/management, and leaves other courses alone", async () => {
    expect(await reconcileZenMode(db, call, "guild")).toEqual([]);
    expect(tables.discord_zen_mutes.map(r => r.discord_user_id).sort()).toEqual(["student", "trial"]);
    expect(voice.student.mute).toBe(true); expect(voice.trial.mute).toBe(true);
    for (const id of ["teacher", "teacher-extra", "co-teacher", "manager"]) expect(voice[id].mute).toBe(false);
    expect(writes.some(w => w.path === "/channels/other")).toBe(false);
    for (const id of ["live", "breakout"]) expect(BigInt(channels.find(c => c.id === id)!.permission_overwrites.find(o => o.id === "course-role")!.deny) & speakBit).toBe(speakBit);
  });
  it("turns off mid-class, restoring only Zen mutes and keeping moderation mutes", async () => {
    await reconcileZenMode(db, call, "guild");
    tables.courses[0].zen_mode_enabled = false;
    expect(await reconcileZenMode(db, call, "guild")).toEqual([]);
    expect(voice.student.mute).toBe(false); expect(voice.trial.mute).toBe(false); expect(voice.moderated.mute).toBe(true);
    expect(tables.discord_zen_mutes).toEqual([]); expect(tables.discord_zen_channels).toEqual([]);
    expect(channels[0].permission_overwrites).toEqual(normal());
  });
  it("restores users who move to another call and retries disconnected users when they return", async () => {
    await reconcileZenMode(db, call, "guild");
    voice.student.channel_id = "other"; delete voice.trial;
    await reconcileZenMode(db, call, "guild");
    expect(voice.student.mute).toBe(false);
    expect(tables.discord_zen_mutes.map(r => r.discord_user_id)).toEqual(["trial"]);
    voice.trial = { channel_id: "other", mute: true };
    await reconcileZenMode(db, call, "guild"); expect(voice.trial.mute).toBe(false);
  });
  it("enforces late joins and recovers Discord failures without losing mute ownership", async () => {
    failDiscord = true;
    expect(await reconcileZenMode(db, call, "guild")).toContain("Missing Permissions");
    expect(tables.discord_zen_mutes).toHaveLength(2);
    failDiscord = false;
    expect(await reconcileZenMode(db, call, "guild")).toEqual([]);
    voice.student.mute = false;
    await reconcileZenMode(db, call, "guild"); expect(voice.student.mute).toBe(true);
  });
  it("does not touch Discord on a failed policy/ledger read", async () => {
    failTable = "discord_zen_mutes";
    await expect(reconcileZenMode(db, call, "guild")).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("restores owned mutes and tracked permission bits after the class channel is deleted", async () => {
    await reconcileZenMode(db, call, "guild");
    tables.discord_live_class_channels = []; channels = channels.filter(c => c.id !== "live");
    voice.student.channel_id = "other";
    await reconcileZenMode(db, call, "guild");
    expect(voice.student.mute).toBe(false); expect(voice.trial.mute).toBe(false);
    expect(tables.discord_zen_channels).toEqual([]);
  });
  it("creates future/recovered rooms already quiet, with a normal snapshot for disabling", async () => {
    const prepared = await prepareZenVoice(db, "course", normal());
    expect(BigInt(prepared.overwrites.find(o => o.id === "trial")!.deny) & speakBit).toBe(speakBit);
    await prepared.remember("live");
    expect((tables.discord_zen_channels[0].original_permissions as Record<string, Row>)["0:course-role"].allow).toBe(String(speakBit));
  });
  it("rejects a concurrent toggle without modifying the course", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(syncZenMode(db, { courseId: "course", enabled: false })).rejects.toBeInstanceOf(ZenBusyError);
    expect(tables.courses[0].zen_mode_enabled).toBe(true);
  });
  it("waits for an in-flight event before saving a toggle, and releases the lease on failure", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValue({ data: true, error: null });
    // Stop at policy loading so this tests lease ordering without live Discord.
    failTable = "discord_live_class_channels";
    const result = syncZenMode(db, { courseId: "course", enabled: false }, { memberIds: [], waitForLeaseMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(tables.courses[0].zen_mode_enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).problems).toEqual(["Database unavailable"]);
    expect(tables.courses[0].zen_mode_enabled).toBe(false);
    expect(rpc.mock.calls.at(-1)?.[0]).toBe("release_zen_mode_sync");
  });
  it("does not give converted trial students the former tutor account's speaking exemption", async () => {
    tables.approved_discord_accounts.push({ discord_user_id: "trial", owner_user_id: "owner" });
    tables.class_trials = [{ id: "trial", class_id: "lesson", discord_user_id: "trial", revoked_at: null,
      lesson: { id: "lesson", course_id: "course", starts_at: new Date().toISOString(), duration_hours: 1,
        course: { id: "course", deleted_at: null, is_completed: false } } }];
    await reconcileZenMode(db, call, "guild");
    expect(voice.trial.mute).toBe(true);
    expect(BigInt(channels[1].permission_overwrites.find(o => o.id === "trial")!.deny) & speakBit).toBe(speakBit);
  });
});
