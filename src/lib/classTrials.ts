import { classEndMs } from "@/lib/classTiming";
import type { DiscordPermissionOverwrite } from "@/lib/discordLiveChannels";

export const trialLeadMs = 5 * 60_000;
export const trialGraceMs = 30 * 60_000;
export const discordIdPattern = /^\d{17,20}$/;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TrialLesson = {
  id: string; course_id: string; title: string; starts_at: string; duration_hours: number | string;
  course: { id: string; title: string; deleted_at: string | null; is_completed: boolean } | null;
};
export type ClassTrial = {
  id: string; class_id: string | null; discord_user_id: string; student_name: string;
  created_at: string; revoked_at: string | null; lesson: TrialLesson | null;
};

export function trialWindow(lesson: TrialLesson | null) {
  if (!lesson || !lesson.course || lesson.course.deleted_at || lesson.course.is_completed) return null;
  const start = Date.parse(lesson.starts_at);
  const duration = Number(lesson.duration_hours);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
  return { opensAtMs: start - trialLeadMs, expiresAtMs: classEndMs(start, duration) + trialGraceMs };
}

/** Guests may join the server as soon as booked, but class access opens later. */
export function trialStatus(trial: ClassTrial, nowMs: number): "revoked" | "expired" | "scheduled" | "open" {
  if (trial.revoked_at) return "revoked";
  const window = trialWindow(trial.lesson);
  if (!window || nowMs >= window.expiresAtMs) return "expired";
  return nowMs < window.opensAtMs ? "scheduled" : "open";
}

export function trialGuestsForClass(trials: ClassTrial[], classId: string, nowMs: number): string[] {
  return [...new Set(trials.filter(t => t.class_id === classId && trialStatus(t, nowMs) === "open")
    .map(t => t.discord_user_id))];
}

/** Change only trial-managed member entries; preserve tutor/bot and role access. */
export function withTrialOverwrites(
  existing: DiscordPermissionOverwrite[], knownTrialIds: Set<string>, allowedIds: string[],
  kind: "text" | "voice", protectedIds = new Set<string>(),
): DiscordPermissionOverwrite[] {
  const result = existing.filter(o => o.type !== 1 || !knownTrialIds.has(o.id) || protectedIds.has(o.id));
  const allow = String(kind === "voice" ? 1024 | 1048576 | 2097152 : 1024 | 2048 | 65536);
  for (const id of new Set(allowedIds)) {
    if (!protectedIds.has(id) && !result.some(o => o.type === 1 && o.id === id)) {
      result.push({ id, type: 1, allow, deny: "0" });
    }
  }
  return result;
}

/** Evaluate remaining access before disconnecting a former trial attendee. */
export function canStillJoinVoice(memberId: string, roleIds: Set<string>, roles: { id: string; permissions?: string }[], guildId: string, overwrites: DiscordPermissionOverwrite[]) {
  let permissions = roles.filter(r => r.id === guildId || roleIds.has(r.id)).reduce((bits, r) => bits | BigInt(r.permissions ?? "0"), BigInt(0));
  if (permissions & BigInt(8)) return true; // Administrator bypasses channel overwrites.
  const apply = (entries: DiscordPermissionOverwrite[]) => {
    const deny = entries.reduce((bits, o) => bits | BigInt(o.deny), BigInt(0));
    const allow = entries.reduce((bits, o) => bits | BigInt(o.allow), BigInt(0));
    permissions = (permissions & ~deny) | allow;
  };
  apply(overwrites.filter(o => o.type === 0 && o.id === guildId));
  apply(overwrites.filter(o => o.type === 0 && o.id !== guildId && roleIds.has(o.id)));
  apply(overwrites.filter(o => o.type === 1 && o.id === memberId));
  return (permissions & BigInt(1024 | 1048576)) === BigInt(1024 | 1048576);
}
