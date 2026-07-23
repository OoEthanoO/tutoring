// Permission overwrites for the temporary live class voice channels created by
// the class-reminders cron. Lives in lib (rather than the route file) so the
// logic can be unit-tested — route files may only export route handlers.

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
