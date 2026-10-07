import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabasePaging";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import type { DiscordPermissionOverwrite } from "@/lib/discordLiveChannels";
import { canStillJoinVoice, trialStatus } from "@/lib/classTrials";
import { loadClassTrials } from "@/lib/classTrialsServer";
import { applyZenPermissions, restoreZenPermissions, snapshotZenPermissions, type ZenPermissionSnapshot } from "@/lib/zenMode";
import { getZenVoiceMembers } from "@/lib/zenGatewayClient";

type Course = { id: string; zen_mode_enabled: boolean; created_by: string | null; co_tutor_id: string | null; deleted_at: string | null };
type User = { id: string; discord_user_id: string | null; email: string; role: string; custom_roles?: { role_level: string; name: string }[] | null };
export type ZenPolicy = { enabled: boolean; speakers: Set<string> };
export async function loadZenPolicies(db: SupabaseClient): Promise<Map<string, ZenPolicy>> {
  const [courses, users, extras, trials] = await Promise.all([
    fetchAllRows((from, to) => db.from("courses").select("id, zen_mode_enabled, created_by, co_tutor_id, deleted_at").order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("app_users").select("id, discord_user_id, email, role, custom_roles(role_level, name)").order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("approved_discord_accounts").select("discord_user_id, owner_user_id").order("discord_user_id").range(from, to)),
    loadClassTrials(db),
  ]);
  // A conversion can land between the parallel snapshots. A trial never
  // inherits speaking privileges from an old tutor-linked approval.
  const trialIds = new Set(trials.filter(t => ["scheduled", "open"].includes(trialStatus(t, Date.now()))).map(t => t.discord_user_id));
  const leadershipIds = new Set((users as User[]).filter(u => isFounder(resolveAccountRole(u))).map(u => u.id));
  return new Map((courses as Course[]).map(c => {
    const owners = new Set([...leadershipIds, c.created_by, c.co_tutor_id]);
    const speakers = new Set((users as User[]).filter(u => owners.has(u.id) && u.discord_user_id).map(u => u.discord_user_id!));
    for (const extra of extras) if (owners.has(extra.owner_user_id) && !trialIds.has(extra.discord_user_id)) speakers.add(extra.discord_user_id);
    return [c.id, { enabled: c.zen_mode_enabled && !c.deleted_at, speakers }];
  }));
}

type Channel = { id: string; type: number; permission_overwrites?: DiscordPermissionOverwrite[] };
type Member = { user: { id: string; bot?: boolean }; roles: string[] };
type Role = { id: string; permissions: string };
type Voice = { channel_id: string; mute: boolean };
type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;
export type ZenSyncOptions = { memberIds?: string[]; voicesOnly?: boolean; waitForLeaseMs?: number };
const check = (result: { error?: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };
const message = (error: unknown) => error instanceof Error ? error.message : "Could not apply Zen mode.";

/** Used at channel creation/recovery and permission rebuilds: start quiet. */
export async function prepareZenVoice(db: SupabaseClient, courseId: string, normal: DiscordPermissionOverwrite[]) {
  const policy = (await loadZenPolicies(db)).get(courseId);
  // Existing member grants are the bot/tutors/trials. Only policy speakers and
  // the bot (Manage Channels) are exempt; leadership gets explicit member grants.
  const botIds = normal.filter(o => o.type === 1 && (BigInt(o.allow) & BigInt(16)) !== BigInt(0)).map(o => o.id);
  return {
    overwrites: policy?.enabled ? applyZenPermissions(normal, new Set([...policy.speakers, ...botIds]), new Set()) : normal,
    remember: async (id: string) => {
      if (policy?.enabled) check(await db.from("discord_zen_channels").upsert({
        discord_channel_id: id, original_permissions: snapshotZenPermissions(normal),
      }, { onConflict: "discord_channel_id", ignoreDuplicates: true }));
    },
  };
}

function discordClient(deadline: number): { call: Call; guildId: string } {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID ?? "";
  const call: Call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    if (!token || !guildId) throw new Error("Discord is not configured.");
    for (let attempt = 0; attempt < 3; attempt++) {
      // Share Discord's cooldown between voice events and ordinary sync calls
      // in this process. Never shorten retry_after to keep an event "instant".
      const runtime = globalThis as typeof globalThis & { yanlearnZenRetryAfter?: number };
      const wait = Math.max(0, (runtime.yanlearnZenRetryAfter ?? 0) - Date.now());
      if (wait) {
        if (Date.now() + wait >= deadline) throw new Error("Discord is rate limited; Zen mode will retry.");
        await new Promise(resolve => setTimeout(resolve, wait));
      }
      if (Date.now() >= deadline) throw new Error("Discord is taking longer than expected. Remaining changes will retry on the next sync.");
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "X-Audit-Log-Reason": "YanLearn Zen mode" },
        body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 404 && method === "GET") return null as T;
      if (response.status === 429) {
        const seconds = Number(data?.retry_after ?? response.headers.get("retry-after") ?? 1);
        runtime.yanlearnZenRetryAfter = Date.now() + (Number.isFinite(seconds) ? Math.max(0.1, seconds) : 1) * 1000;
        if (attempt < 2) continue;
      }
      if (!response.ok) throw new Error(data?.message ?? `Discord returned ${response.status}.`);
      return data as T;
    }
    throw new Error("Discord is busy; the next sync will retry Zen mode.");
  };
  return { call, guildId };
}

/** Caller holds the shared lease. Never treats a failed DB read as an empty list. */
export async function reconcileZenMode(db: SupabaseClient, call: Call, guildId: string, options: ZenSyncOptions = {}): Promise<string[]> {
  const [policies, live, breakouts, saved, mutes] = await Promise.all([
    loadZenPolicies(db),
    fetchAllRows((from, to) => db.from("discord_live_class_channels").select("class_id, course_id, discord_channel_id").is("deleted_at", null).order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_breakout_rooms").select("live_channel_id, discord_channel_id").is("deleted_at", null).order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_zen_channels").select("discord_channel_id, original_permissions").order("discord_channel_id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_zen_mutes").select("discord_user_id").order("discord_user_id").range(from, to)),
  ]);
  const courseByChannel = new Map(live.map(r => [r.discord_channel_id, r.course_id]));
  for (const r of breakouts) if (courseByChannel.has(r.live_channel_id)) courseByChannel.set(r.discord_channel_id, courseByChannel.get(r.live_channel_id)!);
  const active = new Map([...courseByChannel].filter(([, courseId]) => policies.get(courseId)?.enabled));
  if (!active.size && !saved.length && !mutes.length) return [];
  const [channels, roles] = await Promise.all([
    options.voicesOnly ? Promise.resolve([] as Channel[]) : call<Channel[]>("GET", `/guilds/${guildId}/channels`),
    call<Role[]>("GET", `/guilds/${guildId}/roles`),
  ]);
  if (!channels || !roles) throw new Error("Could not read Discord channels or roles.");
  const members: Member[] = [];
  if (options.memberIds && options.memberIds.length <= 3) {
    // Connected members from the Gateway, or the member whose voice changed.
    // Fetch current roles; event payloads may already be stale by the time we run.
    for (const id of new Set(options.memberIds)) {
      const member = await call<Member | null>("GET", `/guilds/${guildId}/members/${id}`);
      if (member) members.push(member);
    }
  } else {
    const requested = options.memberIds ? new Set(options.memberIds) : null;
    let after = "";
    for (;;) {
      const page = await call<Member[]>("GET", `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ""}`);
      if (!page) throw new Error("Could not read Discord members.");
      // A class-wide toggle needs one roster request, not one REST round trip
      // per student. Only connected/requested people need voice-state reads.
      members.push(...page.filter(m => !requested || requested.has(m.user.id) || m.user.bot));
      if (page.length < 1000) break;
      after = page[page.length - 1].user.id;
    }
  }
  const botIds = members.filter(m => m.user.bot).map(m => m.user.id);
  if (process.env.DISCORD_CLIENT_ID) botIds.push(process.env.DISCORD_CLIENT_ID);
  const adminRoles = new Set(roles.filter(r => (BigInt(r.permissions) & BigInt(8)) !== BigInt(0)).map(r => r.id));
  const savedById = new Map(saved.map(r => [r.discord_channel_id, r.original_permissions as ZenPermissionSnapshot]));
  const errors: string[] = [];
  for (const channel of channels) {
    if (channel.type !== 2 || (!active.has(channel.id) && !savedById.has(channel.id))) continue;
    try {
      const current = channel.permission_overwrites ?? [];
      let next: DiscordPermissionOverwrite[];
      if (active.has(channel.id)) {
        if (!savedById.has(channel.id)) {
          const original = snapshotZenPermissions(current);
          check(await db.from("discord_zen_channels").insert({ discord_channel_id: channel.id, original_permissions: original }));
          savedById.set(channel.id, original);
        }
        next = applyZenPermissions(current, new Set([...policies.get(active.get(channel.id)!)!.speakers, ...botIds]), adminRoles);
      } else next = restoreZenPermissions(current, savedById.get(channel.id)!);
      if (JSON.stringify(current) !== JSON.stringify(next)) await call("PATCH", `/channels/${channel.id}`, { permission_overwrites: next });
      channel.permission_overwrites = next;
      if (!active.has(channel.id)) check(await db.from("discord_zen_channels").delete().eq("discord_channel_id", channel.id));
    } catch (error) { errors.push(message(error)); }
  }
  for (const id of options.voicesOnly ? [] : savedById.keys()) {
    if (!channels.some(c => c.id === id)) check(await db.from("discord_zen_channels").delete().eq("discord_channel_id", id));
  }
  const ownedMutes = new Set(mutes.map(m => String(m.discord_user_id)));
  for (const member of members) {
    const id = member.user.id;
    if (member.user.bot) continue;
    // Only query voice for existing Zen mutes and members with access to a
    // currently affected call. This includes trials without website accounts.
    if (!options.memberIds && !ownedMutes.has(id) && !channels.some(c => active.has(c.id) && !policies.get(active.get(c.id)!)!.speakers.has(id) &&
      canStillJoinVoice(id, new Set(member.roles), roles, guildId, c.permission_overwrites ?? []))) continue;
    try {
      const state = await call<Voice | null>("GET", `/guilds/${guildId}/voice-states/${id}`);
      if (!state?.channel_id) continue; // Discord cannot unmute a disconnected member; retry on rejoin.
      const policy = policies.get(active.get(state.channel_id) ?? "");
      const shouldMute = policy?.enabled && !policy.speakers.has(id) && !member.roles.some(r => adminRoles.has(r));
      if (shouldMute && !state.mute) {
        // Persist intent before Discord, so a timeout/process exit is recoverable.
        if (!ownedMutes.has(id)) {
          check(await db.from("discord_zen_mutes").insert({ discord_user_id: id }));
          ownedMutes.add(id);
        }
        await call("PATCH", `/guilds/${guildId}/members/${id}`, { mute: true });
      } else if (!shouldMute && ownedMutes.has(id)) {
        if (state.mute) await call("PATCH", `/guilds/${guildId}/members/${id}`, { mute: false });
        check(await db.from("discord_zen_mutes").delete().eq("discord_user_id", id));
      }
    } catch (error) { errors.push(message(error)); }
  }
  // A targeted check is not a guild roster. Retain disconnected members' ledger
  // entries so their next join can remove a carried-over Zen mute.
  for (const id of options.memberIds ? [] : ownedMutes) {
    if (!members.some(m => m.user.id === id)) check(await db.from("discord_zen_mutes").delete().eq("discord_user_id", id));
  }
  return [...new Set(errors)];
}

export class ZenBusyError extends Error {}
export async function syncZenMode(db: SupabaseClient, change?: { courseId: string; enabled: boolean }, options: ZenSyncOptions = {}): Promise<{ problems: string[] }> {
  const token = randomUUID();
  const waitUntil = Date.now() + Math.min(10000, options.waitForLeaseMs ?? 0);
  for (;;) {
    const claim = await db.rpc("claim_zen_mode_sync", { p_token: token });
    check(claim);
    if (claim.data) break;
    if (Date.now() >= waitUntil) throw new ZenBusyError("Zen mode is updating. Please try again in a moment.");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  try {
    if (change) check(await db.from("courses").update({ zen_mode_enabled: change.enabled }).eq("id", change.courseId).is("deleted_at", null));
    const { call, guildId } = discordClient(Date.now() + 45_000);
    try {
      const memberIds = options.memberIds ?? await getZenVoiceMembers() ?? undefined;
      return { problems: await reconcileZenMode(db, call, guildId, { ...options, memberIds }) };
    }
    catch (error) { return { problems: [message(error)] }; }
  } finally {
    check(await db.rpc("release_zen_mode_sync", { p_token: token }));
  }
}
