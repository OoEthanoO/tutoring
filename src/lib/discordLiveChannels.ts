// Permission overwrites for the temporary live class voice channels created by
// the class-reminders cron. Lives in lib (rather than the route file) so the
// logic can be unit-tested — route files may only export route handlers.

// A live class voice channel is only ever deleted once it is past its scheduled
// end AND has been provably empty — absolutely nobody in the call — for more
// than this long. Tearing one down mid-lesson interrupts real teaching, while
// leaving an empty one up costs nothing, so every check is biased towards
// keeping the channel. The safety here comes from genuinely knowing who is in
// the call rather than from waiting a long time, so this window is short.
export const liveChannelEmptyConfirmMs = 5 * 60 * 1000;

export type LiveChannelCleanupDecision = "keep" | "mark-empty" | "clear-empty" | "delete";

/**
 * Whether a live class voice channel may be deleted yet.
 *
 * Deletion requires ALL of:
 *  - the class is past its scheduled end;
 *  - every occupancy lookup succeeded, so the emptiness is known rather than
 *    assumed (`lookupFailed` covers an unreadable member list too, not just a
 *    failed voice-state read);
 *  - absolutely nobody was found in the call;
 *  - and it has been continuously empty for MORE than liveChannelEmptyConfirmMs.
 *
 * Anything short of that keeps the channel. A single sighting of anyone resets
 * the clock, so a flaky connection can never accumulate towards deletion.
 */
export const decideLiveChannelCleanup = ({
  nowMs,
  endsAtMs,
  someonePresent,
  lookupFailed,
  emptySinceMs,
}: {
  nowMs: number;
  endsAtMs: number;
  someonePresent: boolean;
  lookupFailed: boolean;
  emptySinceMs: number | null;
}): LiveChannelCleanupDecision => {
  if (!Number.isFinite(endsAtMs) || nowMs <= endsAtMs) {
    return "keep";
  }

  if (lookupFailed) {
    return "keep";
  }

  if (someonePresent) {
    return emptySinceMs === null ? "keep" : "clear-empty";
  }

  if (emptySinceMs === null || !Number.isFinite(emptySinceMs)) {
    return "mark-empty";
  }

  // Strictly greater: "more than 5 minutes", not "at least".
  return nowMs - emptySinceMs > liveChannelEmptyConfirmMs ? "delete" : "keep";
};

const viewChannelPermission = 1024;
const connectPermission = 1048576;
const speakPermission = 2097152;
const manageChannelsPermission = 16;

export type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

export const normalizeVoiceChannelName = (title: string, fallbackClassId: string) => {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) {
    return normalized.slice(0, 100);
  }
  return `class-${fallbackClassId.slice(0, 8)}`;
};

// Student access is granted through the course role rather than per-user
// overwrites, so students who enroll mid-class get in as soon as the Discord
// sync (which runs at the start of every tick) assigns them the role. Pass a
// null courseRoleId during the tutor-only early-access window (15 to 5 minutes
// before start).
export const buildLiveVoicePermissionOverwrites = ({
  guildId,
  botUserId,
  ceoRoleId,
  cooRoleId,
  tutorDiscordUserId,
  extraMemberDiscordUserIds,
  courseRoleId,
}: {
  guildId: string;
  botUserId: string;
  ceoRoleId: string | null;
  cooRoleId: string | null;
  tutorDiscordUserId: string;
  // Approved extra accounts owned by the tutor (e.g. a second Discord account
  // used in lesson calls); they get the same access window as the tutor.
  extraMemberDiscordUserIds?: string[];
  courseRoleId: string | null;
}): DiscordPermissionOverwrite[] => {
  const allowJoin = String(
    viewChannelPermission | connectPermission | speakPermission
  );
  const allowBot = String(
    viewChannelPermission |
      connectPermission |
      speakPermission |
      manageChannelsPermission
  );
  const denyEveryone = String(
    viewChannelPermission | connectPermission | speakPermission
  );

  const overwrites: DiscordPermissionOverwrite[] = [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: denyEveryone,
    },
    {
      id: botUserId,
      type: 1,
      allow: allowBot,
      deny: "0",
    },
    {
      id: tutorDiscordUserId,
      type: 1,
      allow: allowJoin,
      deny: "0",
    },
  ];

  for (const extraMemberId of new Set(extraMemberDiscordUserIds ?? [])) {
    if (extraMemberId && extraMemberId !== tutorDiscordUserId) {
      overwrites.push({ id: extraMemberId, type: 1, allow: allowJoin, deny: "0" });
    }
  }

  if (ceoRoleId) {
    overwrites.push({ id: ceoRoleId, type: 0, allow: allowJoin, deny: "0" });
  }
  if (cooRoleId) {
    overwrites.push({ id: cooRoleId, type: 0, allow: allowJoin, deny: "0" });
  }

  if (courseRoleId) {
    overwrites.push({
      id: courseRoleId,
      type: 0,
      allow: allowJoin,
      deny: "0",
    });
  }

  return overwrites;
};
