import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabasePaging";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import type { DiscordPermissionOverwrite } from "@/lib/discordLiveChannels";
import { canStillJoinVoice, trialStatus } from "@/lib/classTrials";
import { loadClassTrials } from "@/lib/classTrialsServer";
import { applyZenPermissions, restoreZenPermissions, snapshotZenPermissions, type ZenPermissionSnapshot } from "@/lib/zenMode";

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
      if (Date.now() >= deadline) throw new Error("Discord is taking longer than expected. Remaining changes will retry on the next sync.");
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "X-Audit-Log-Reason": "YanLearn Zen mode" },
        body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 404 && method === "GET") return null as T;
      if (response.status === 429 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, Math.min(3000, Math.max(100, Number(data?.retry_after ?? 1) * 1000))));
        continue;
      }
      if (!response.ok) throw new Error(data?.message ?? `Discord returned ${response.status}.`);
      return data as T;
    }
    throw new Error("Discord is busy; the next sync will retry Zen mode.");
  };
  return { call, guildId };
}

/** Caller holds the shared lease. Never treats a failed DB read as an empty list. */
export async function reconcileZenMode(db: SupabaseClient, call: Call, guildId: string): Promise<string[]> {
  const [policies, live, breakouts, saved, mutes] = await Promise.all([
    loadZenPolicies(db),
    fetchAllRows((from, to) => db.from("discord_live_class_channels").select("class_id, course_id, discord_channel_id").is("deleted_at", null).order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_breakout_rooms").select("class_id, discord_channel_id").is("deleted_at", null).order("id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_zen_channels").select("discord_channel_id, original_permissions").order("discord_channel_id").range(from, to)),
    fetchAllRows((from, to) => db.from("discord_zen_mutes").select("discord_user_id").order("discord_user_id").range(from, to)),
  ]);
  const byClass = new Map(live.map(r => [r.class_id, r.course_id]));
  const courseByChannel = new Map(live.map(r => [r.discord_channel_id, r.course_id]));
  for (const r of breakouts) if (byClass.has(r.class_id)) courseByChannel.set(r.discord_channel_id, byClass.get(r.class_id)!);
  const active = new Map([...courseByChannel].filter(([, courseId]) => policies.get(courseId)?.enabled));
  if (!active.size && !saved.length && !mutes.length) return [];
  const [channels, roles] = await Promise.all([
    call<Channel[]>("GET", `/guilds/${guildId}/channels`), call<Role[]>("GET", `/guilds/${guildId}/roles`),
  ]);
  if (!channels || !roles) throw new Error("Could not read Discord channels or roles.");
  const members: Member[] = [];
  let after = "";
  for (;;) {
    const page = await call<Member[]>("GET", `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ""}`);
    if (!page) throw new Error("Could not read Discord members.");
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  const botIds = members.filter(m => m.user.bot).map(m => m.user.id);
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
  for (const id of savedById.keys()) {
    if (!channels.some(c => c.id === id)) check(await db.from("discord_zen_channels").delete().eq("discord_channel_id", id));
  }
  const ownedMutes = new Set(mutes.map(m => String(m.discord_user_id)));
  for (const member of members) {
    const id = member.user.id;
    if (member.user.bot) continue;
    // Only query voice for existing Zen mutes and members with access to a
    // currently affected call. This includes trials without website accounts.
    if (!ownedMutes.has(id) && !channels.some(c => active.has(c.id) && !policies.get(active.get(c.id)!)!.speakers.has(id) &&
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
  for (const id of ownedMutes) {
    if (!members.some(m => m.user.id === id)) check(await db.from("discord_zen_mutes").delete().eq("discord_user_id", id));
  }
  return [...new Set(errors)];
}

export class ZenBusyError extends Error {}
export async function syncZenMode(db: SupabaseClient, change?: { courseId: string; enabled: boolean }): Promise<{ problems: string[] }> {
  const token = randomUUID();
  const claim = await db.rpc("claim_zen_mode_sync", { p_token: token });
  check(claim);
  if (!claim.data) throw new ZenBusyError("Zen mode is updating. Please try again in a moment.");
  try {
    if (change) check(await db.from("courses").update({ zen_mode_enabled: change.enabled }).eq("id", change.courseId).is("deleted_at", null));
    const { call, guildId } = discordClient(Date.now() + 45_000);
    try { return { problems: await reconcileZenMode(db, call, guildId) }; }
    catch (error) { return { problems: [message(error)] }; }
  } finally {
    check(await db.rpc("release_zen_mode_sync", { p_token: token }));
  }
}
