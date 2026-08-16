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

/**
 * The one exception to "nobody in the call": a channel whose tutor has been out
 * of it for longer than this is torn down even with students still sitting in
 * it. Past the scheduled end, a room the tutor left this long ago is not a
 * lesson any more — it is a hangout keeping a temporary channel alive
 * indefinitely, because students who never leave mean the emptiness clock above
 * never starts.
 *
 * Absence is measured from when the tutor was last seen in the channel (their
 * `class_attendance.last_seen_at`), so it can already have been running for most
 * of the class by the time the class ends; a tutor who never joined at all
 * counts as absent since the scheduled start.
 */
export const liveChannelTutorAbsenceMs = 30 * 60 * 1000;

/**
 * Courses whose first class falls on or after this date run their lessons in
 * Discord voice channels; older ones stayed on the legacy Zoom flow. Only
 * voice-system courses produce attendance and presence data, so anything
 * reasoning about missing attendance has to apply the same cutoff.
 */
export const discordVoiceSystemStartMs = new Date("2026-06-24T00:00:00Z").getTime();

/** Whether a course (identified by its first class date) uses Discord voice. */
export const courseUsesDiscordVoiceSystem = (firstClassDate: Date | null): boolean =>
  firstClassDate !== null &&
  Number.isFinite(firstClassDate.getTime()) &&
  firstClassDate.getTime() >= discordVoiceSystemStartMs;

export type LiveChannelCleanupDecision = "keep" | "mark-empty" | "clear-empty" | "delete";

/**
 * Whether a live class voice channel may be deleted yet.
 *
 * There are two independent grounds for deletion, both of which require the
 * class to be past its scheduled end.
 *
 * The tutor has been gone too long. Requires ALL of:
 *  - the tutor's own voice state was read successfully (`tutorLookupFailed`
 *    covers not knowing who the tutor is, too);
 *  - the tutor is not in the call right now;
 *  - and they were last in it MORE than liveChannelTutorAbsenceMs ago.
 * Students still in the call do not block this one — that is the whole point of
 * it, since otherwise they keep the channel alive forever.
 *
 * Otherwise, the call is provably empty. Requires ALL of:
 *  - every occupancy lookup succeeded, so the emptiness is known rather than
 *    assumed (`lookupFailed` covers an unreadable member list too, not just a
 *    failed voice-state read);
 *  - absolutely nobody was found in the call;
 *  - and it has been continuously empty for MORE than liveChannelEmptyConfirmMs.
 *
 * Anything short of either keeps the channel. A single sighting of anyone resets
 * the emptiness clock, so a flaky connection can never accumulate towards
 * deletion, and one sighting of the tutor restarts their absence clock too.
 */
export const decideLiveChannelCleanup = ({
  nowMs,
  endsAtMs,
  someonePresent,
  lookupFailed,
  emptySinceMs,
  tutorPresent = false,
  tutorLookupFailed = true,
  tutorLastSeenMs = null,
}: {
  nowMs: number;
  endsAtMs: number;
  someonePresent: boolean;
  lookupFailed: boolean;
  emptySinceMs: number | null;
  /** Whether the tutor (or an approved extra account of theirs) is in the call. */
  tutorPresent?: boolean;
  /**
   * Whether the tutor's voice state is unknown this tick — a failed read, or no
   * recorded tutor to read. Unknown never counts as absent; the default leaves
   * the absence rule switched off for callers that cannot supply this.
   */
  tutorLookupFailed?: boolean;
  /**
   * When the tutor was last seen in this class's channel, falling back to the
   * scheduled start when they never joined at all.
   */
  tutorLastSeenMs?: number | null;
}): LiveChannelCleanupDecision => {
  if (!Number.isFinite(endsAtMs) || nowMs <= endsAtMs) {
    return "keep";
  }

  if (
    !tutorLookupFailed &&
    !tutorPresent &&
    tutorLastSeenMs !== null &&
    Number.isFinite(tutorLastSeenMs) &&
    // Strictly greater: "more than 30 minutes", not "at least".
    nowMs - tutorLastSeenMs > liveChannelTutorAbsenceMs
  ) {
    return "delete";
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
