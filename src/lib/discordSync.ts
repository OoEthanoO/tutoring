import type { SupabaseClient } from "@supabase/supabase-js";
import { founderEmails, resolveUserRole } from "@/lib/roles";
import { fetchFundraisingRaisedAmount } from "@/lib/fundraising";
import { classEndMs } from "@/lib/classTiming";

const discordApiBase = "https://discord.com/api/v10";
const courseTopicPrefix = "yanlearn-course-id:";
const defaultCoursesCategoryName = "Courses";
const defaultTextCategoryName = "Text";
const defaultVoiceCategoryName = "Voice";
const defaultInfoChannelName = "info";
const defaultReadmeChannelName = "readme";
const defaultTasksChannelName = "tasks";
const defaultWebsiteVoiceChannelName = "learn.ethanyanxu.com";
const defaultEveryoneChatChannelName = "everyone";
const defaultExecutivesOnlyChannelName = "executives";
const defaultFoundersOnlyChannelName = "founders";
const defaultCommitsChannelName = "commits";
const defaultSocialMediaChannelName = "social-media";
const defaultScienceTutorsChannelName = "science-tutors";
const defaultMathTutorsChannelName = "math-tutors";
const defaultEveryoneVoiceChannelName = "Everyone";
const defaultExecutivesVoiceChannelName = "Executives";
const defaultSocialMediaVoiceChannelName = "Social Media";
const defaultScienceTutorsVoiceChannelName = "Science Tutors";
const defaultMathTutorsVoiceChannelName = "Math Tutors";
const defaultNonprofitTeamChannelName = "nonprofit-team";
const defaultNonprofitTeamVoiceChannelName = "Nonprofit Team";
const defaultDevelopmentTeamChannelName = "development-team";
const defaultDevelopmentTeamVoiceChannelName = "Development Team";
const discordTextChannelType = 0;
const discordVoiceChannelType = 2;
const discordCategoryChannelType = 4;
const channelNameLimit = 100;
const roleNameLimit = 100;

const viewChannelPermission = 1024;
const sendMessagesPermission = 2048;
const readMessageHistoryPermission = 65536;
const connectPermission = 1048576;
const manageChannelsPermission = 16;
const pinMessagesPermission = BigInt(1) << BigInt(51);
const deletionDelayMs = 7 * 24 * 60 * 60 * 1000;
const fundraiserVoiceChannelNamePattern = /^\$\d[\d,]*\sraised$/i;

type WebsiteUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  discord_user_id: string | null;
  is_junior: boolean | null;
  strike_count?: number | null;
  custom_roles?: { name: string; role_level: string } | { name: string; role_level: string }[] | null;
};

type CourseRow = {
  id: string;
  title: string;
  is_completed: boolean;
  created_by: string | null;
  co_tutor_id?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at?: string | null;
  course_classes?: CourseClassRow[] | null;
};

type CourseEnrollmentRow = {
  course_id: string;
  student_id: string;
};

type ApprovedDiscordAccountRow = {
  discord_user_id: string;
  owner_user_id: string | null;
};

type CourseClassRow = {
  starts_at: string;
  duration_hours: number | string;
};

type DiscordUser = {
  id: string;
  username: string;
  bot?: boolean;
};

type DiscordGuildMember = {
  user?: DiscordUser;
  nick?: string | null;
  roles?: string[];
};

type DiscordRole = {
  id: string;
  name: string;
  position?: number;
  managed?: boolean;
};

type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

type DiscordGuildChannel = {
  id: string;
  name: string;
  type: number;
  position?: number;
  topic?: string | null;
  parent_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type CreateGuildChannelPayload = {
  name: string;
  type: number;
  topic?: string;
  parent_id?: string;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type UpdateGuildChannelPayload = {
  name?: string;
  position?: number;
  topic?: string;
  parent_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type DiscordSyncResult = {
  enabled: boolean;
  skippedReason: string | null;
  kickedMemberCount: number;
  createdCategoryCount: number;
  createdRoleCount: number;
  createdCourseRoleCount: number;
  baseRoleAddedCount: number;
  baseRoleRemovedCount: number;
  courseRoleAddedCount: number;
  courseRoleRemovedCount: number;
  createdChannelCount: number;
  updatedChannelCount: number;
  deletedChannelCount: number;
  deletedCourseRoleCount: number;
  updatedMemberNickCount: number;
  errors: string[];
};

type DiscordSyncParams = {
  adminClient: SupabaseClient;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Exported for tests.
export const normalizeChannelName = (title: string, fallbackCourseId: string): string => {
  const withoutDash = title.toLowerCase().replaceAll("-", "");
  const withOnlyWordCharacters = withoutDash.replace(/[^a-z0-9\s]/g, " ");
  const collapsed = withOnlyWordCharacters
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (collapsed.length > 0) {
    return collapsed.slice(0, channelNameLimit);
  }

  return `course-${fallbackCourseId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10)}`;
};

export const normalizeRoleName = (title: string, fallbackCourseId: string): string => {
  const trimmed = title.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, roleNameLimit);
  }
  return `Course ${fallbackCourseId.slice(0, 8)}`;
};

const getCourseRoleSuffix = (courseId: string) => {
  const compact = courseId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return compact.slice(0, 10) || "course";
};

const roleNameExists = (
  roles: DiscordRole[],
  name: string,
  excludeRoleId?: string
) => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return roles.some((role) => {
    if (role.managed) {
      return false;
    }
    if (excludeRoleId && role.id === excludeRoleId) {
      return false;
    }
    return role.name.trim().toLowerCase() === normalized;
  });
};

export const buildUniqueCourseRoleName = (
  baseName: string,
  courseId: string,
  roles: DiscordRole[],
  excludeRoleId?: string
) => {
  const normalizedBase = baseName.trim().slice(0, roleNameLimit) || "Course";
  if (!roleNameExists(roles, normalizedBase, excludeRoleId)) {
    return normalizedBase;
  }

  const suffixSeed = getCourseRoleSuffix(courseId);
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const suffix = attempt === 1 ? ` (${suffixSeed})` : ` (${suffixSeed}-${attempt})`;
    const maxBaseLength = Math.max(1, roleNameLimit - suffix.length);
    const candidate = `${normalizedBase.slice(0, maxBaseLength)}${suffix}`;
    if (!roleNameExists(roles, candidate, excludeRoleId)) {
      return candidate;
    }
  }

  return `${normalizedBase.slice(0, roleNameLimit - 4)}-alt`;
};

export const getCourseTopicMarker = (courseId: string, flags: string = "") => {
  const suffix = flags ? `|${flags}` : "";
  return `${courseTopicPrefix}${courseId}${suffix}`;
};

export const readCourseIdFromTopic = (topic?: string | null) => {
  const value = String(topic ?? "").trim();
  if (!value.startsWith(courseTopicPrefix)) {
    return { id: "", flags: "" };
  }
  const content = value.slice(courseTopicPrefix.length).trim();
  const [id, flags] = content.split("|");
  return { id: id ?? "", flags: flags ?? "" };
};

export const getCourseEndedAtMs = (course: CourseRow) => {
  if (course.is_completed) {
    return 0;
  }

  const classRows = Array.isArray(course.course_classes)
    ? course.course_classes
    : [];
  if (classRows.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let latestClassEndMs = Number.NEGATIVE_INFINITY;
  for (const classRow of classRows) {
    const startsAtMs = new Date(String(classRow.starts_at)).getTime();
    if (Number.isNaN(startsAtMs)) {
      continue;
    }

    latestClassEndMs = Math.max(
      latestClassEndMs,
      classEndMs(startsAtMs, classRow.duration_hours)
    );
  }

  if (!Number.isFinite(latestClassEndMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return latestClassEndMs;
};

/**
 * One member of the join/leave snapshot persisted to
 * `site_settings.discord_member_snapshot` between sync runs.
 *
 * `name` is the member's YanLearn full name (or email). It is stored alongside
 * the Discord username so a leave notice can still name someone whose website
 * account is gone by the time we notice they left — deleting the account is
 * itself a reason the sync kicks them.
 */
export type DiscordMemberSnapshotEntry = {
  username: string;
  name: string;
};

export type DiscordMemberSnapshot = Record<string, DiscordMemberSnapshotEntry>;

/**
 * Read one snapshot entry. Snapshots written before this stored a bare Discord
 * username string per member, so those stay readable (without a name).
 */
export const parseMemberSnapshotEntry = (
  value: unknown
): DiscordMemberSnapshotEntry => {
  if (typeof value === "string") {
    return { username: value, name: "" };
  }

  if (value && typeof value === "object") {
    const entry = value as { username?: unknown; name?: unknown };
    return {
      username: typeof entry.username === "string" ? entry.username : "",
      name: typeof entry.name === "string" ? entry.name : "",
    };
  }

  return { username: "", name: "" };
};

export const parseMemberSnapshot = (value: unknown): DiscordMemberSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot: DiscordMemberSnapshot = {};
  for (const [memberId, entry] of Object.entries(value as Record<string, unknown>)) {
    snapshot[memberId] = parseMemberSnapshotEntry(entry);
  }
  return snapshot;
};

/** "Ada Lovelace @ada (<@123>)" — falls back through handle, then raw id. */
export const formatMemberLabel = (input: {
  memberId: string;
  username?: string | null;
  name?: string | null;
}): string => {
  const name = String(input.name ?? "").trim();
  const username = String(input.username ?? "").trim();
  const handle = username ? `@${username}` : "";
  const display = [name, handle].filter(Boolean).join(" ") || input.memberId;
  return `${display} (<@${input.memberId}>)`;
};

const getCourseStartedAtMs = (course: CourseRow) => {
  const classRows = Array.isArray(course.course_classes)
    ? course.course_classes
    : [];
  if (classRows.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let earliestClassStartMs = Number.POSITIVE_INFINITY;
  for (const classRow of classRows) {
    const startsAtMs = new Date(String(classRow.starts_at)).getTime();
    if (Number.isNaN(startsAtMs)) {
      continue;
    }
    earliestClassStartMs = Math.min(earliestClassStartMs, startsAtMs);
  }

  return earliestClassStartMs;
};

const buildCoursePermissionOverwrites = (
  guildId: string,
  courseRoleId: string,
  executiveRoleId: string,
  juniorExecutiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );
  const pinOnlyAllow = pinMessagesPermission.toString();

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: courseRoleId,
      type: 0,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: pinOnlyAllow,
      deny: "0",
    },
    {
      id: juniorExecutiveRoleId,
      type: 0,
      allow: pinOnlyAllow,
      deny: "0",
    },
    {
      id: founderRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: pinOnlyAllow,
      deny: "0",
    },
    {
      // Keep bot access so future sync runs can still patch the channel.
      id: botUserId,
      type: 1,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildInfoPermissionOverwrites = (
  guildId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const readOnlyAllow = String(viewChannelPermission | readMessageHistoryPermission);
  const founderAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  return [
    {
      id: guildId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: founderRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(founderAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildTasksPermissionOverwrites = (
  guildId: string,
  executiveRoleId: string,
  juniorExecutiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const readOnlyAllow = String(viewChannelPermission | readMessageHistoryPermission);
  const founderAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: juniorExecutiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: founderRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(founderAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildReadmePermissionOverwrites = (
  guildId: string,
  executiveRoleId: string,
  juniorExecutiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const readOnlyAllow = String(viewChannelPermission | readMessageHistoryPermission);
  const founderAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: juniorExecutiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: founderRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: founderAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(founderAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildWebsiteVoicePermissionOverwrites = (
  guildId: string,
  botUserId: string
): DiscordPermissionOverwrite[] => [
    {
      id: guildId,
      type: 0,
      allow: String(viewChannelPermission),
      deny: String(connectPermission),
    },
    {
      id: botUserId,
      type: 1,
      allow: String(viewChannelPermission | manageChannelsPermission),
      deny: String(connectPermission),
    },
  ];

const buildEveryoneChatPermissionOverwrites = (
  guildId: string,
  studentRoleId: string,
  executiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: studentRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: founderRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};


const buildEveryoneVoicePermissionOverwrites = (
  guildId: string,
  studentRoleId: string,
  executiveRoleId: string,
  juniorExecutiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(viewChannelPermission | connectPermission);

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: studentRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: juniorExecutiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: founderRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: cooRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildCommitsPermissionOverwrites = (
  guildId: string,
  executiveRoleId: string,
  juniorExecutiveRoleId: string,
  founderRoleId: string,
  botUserId: string,
  ceoRoleId: string,
  cooRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const readOnlyAllow = String(
    viewChannelPermission | readMessageHistoryPermission
  );

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission | sendMessagesPermission),
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: juniorExecutiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: founderRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: ceoRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: cooRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: chiefExecutiveRoleId,
      type: 0,
      allow: readOnlyAllow,
      deny: String(sendMessagesPermission),
    },
    {
      id: botUserId,
      type: 1,
      allow: (BigInt(readOnlyAllow) | BigInt(sendMessagesPermission) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
};

const buildFoundersPermissionOverwrites = (
  guildId: string,
  founderRoleId: string,
  botUserId: string,
  cooRoleId: string,
  ceoRoleId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | readMessageHistoryPermission | sendMessagesPermission
  );

  return [
    { id: guildId, type: 0, allow: "0", deny: String(viewChannelPermission) },
    { id: founderRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: cooRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: ceoRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: botUserId, type: 1, allow: activeAllow, deny: "0" },
  ];
};




const buildRoleExclusiveTextPermissionOverwrites = (
  guildId: string,
  roleId: string,
  botUserId: string,
  extraRoleIds: string[] = []
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  const overwrites = [
    {
      id: guildId,
      type: 0 as const,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: roleId,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1 as const,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];

  for (const extra of extraRoleIds) {
    overwrites.push({
      id: extra,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    });
  }

  return overwrites;
};

const buildRoleExclusiveVoicePermissionOverwrites = (
  guildId: string,
  roleId: string,
  botUserId: string,
  extraRoleIds: string[] = []
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(viewChannelPermission | connectPermission);

  const overwrites = [
    {
      id: guildId,
      type: 0 as const,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: roleId,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1 as const,
      allow: (BigInt(activeAllow) | BigInt(manageChannelsPermission)).toString(),
      deny: "0",
    },
  ];
  for (const extra of extraRoleIds) {
    overwrites.push({
      id: extra,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    });
  }
  return overwrites;
};

const sortOverwriteKeys = (overwrites: DiscordPermissionOverwrite[] | undefined) =>
  (overwrites ?? [])
    .map(
      (item) =>
        `${item.id}:${String(item.type)}:${String(item.allow)}:${String(item.deny)}`
    )
    .sort();

export const areOverwritesEqual = (
  current: DiscordPermissionOverwrite[] | undefined,
  expected: DiscordPermissionOverwrite[] | undefined
) => {
  const left = sortOverwriteKeys(current);
  const right = sortOverwriteKeys(expected);
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

class DiscordApiClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>({
    method,
    path,
    body,
  }: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<T> {
    const url = `${discordApiBase}${path}`;
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const textPayload = await response.text();
      let jsonPayload: Record<string, unknown> | null = null;
      if (textPayload) {
        try {
          jsonPayload = JSON.parse(textPayload) as Record<string, unknown>;
        } catch {
          jsonPayload = null;
        }
      }

      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfterFromBody = Number(jsonPayload?.retry_after);
        const retryAfterHeader = Number(response.headers.get("retry-after"));
        const retryAfterMs = Number.isFinite(retryAfterFromBody)
          ? Math.ceil(retryAfterFromBody * 1000)
          : Number.isFinite(retryAfterHeader)
            ? Math.ceil(retryAfterHeader * 1000)
            : 500 * 2 ** (attempt - 1);
        await sleep(Math.max(100, retryAfterMs));
        continue;
      }

      if (!response.ok) {
        const errorMessage =
          (jsonPayload?.message as string | undefined)?.trim() ||
          textPayload.trim() ||
          `Discord API error (${response.status}).`;
        throw new Error(errorMessage);
      }

      if (response.status === 204 || !textPayload) {
        return undefined as T;
      }

      return jsonPayload as T;
    }

    throw new Error("Discord API request retry attempts exceeded.");
  }

  async listGuildMembers(guildId: string): Promise<DiscordGuildMember[]> {
    const members: DiscordGuildMember[] = [];
    let after = "";

    while (true) {
      const encodedAfter = after ? `&after=${encodeURIComponent(after)}` : "";
      const chunk = await this.request<DiscordGuildMember[]>({
        method: "GET",
        path: `/guilds/${guildId}/members?limit=1000${encodedAfter}`,
      });

      if (!Array.isArray(chunk) || chunk.length === 0) {
        break;
      }

      members.push(...chunk);
      const lastUserId = chunk[chunk.length - 1]?.user?.id;
      if (!lastUserId || chunk.length < 1000) {
        break;
      }
      after = lastUserId;
    }

    return members;
  }

  listGuildRoles(guildId: string) {
    return this.request<DiscordRole[]>({
      method: "GET",
      path: `/guilds/${guildId}/roles`,
    });
  }

  createGuildRole(guildId: string, name: string) {
    return this.request<DiscordRole>({
      method: "POST",
      path: `/guilds/${guildId}/roles`,
      body: { name },
    });
  }

  updateGuildRole(guildId: string, roleId: string, payload: { name?: string }) {
    return this.request<DiscordRole>({
      method: "PATCH",
      path: `/guilds/${guildId}/roles/${roleId}`,
      body: payload,
    });
  }

  updateGuildRolePositions(guildId: string, payload: { id: string; position?: number }[]) {
    return this.request<DiscordRole[]>({
      method: "PATCH",
      path: `/guilds/${guildId}/roles`,
      body: payload,
    });
  }

  deleteGuildRole(guildId: string, roleId: string) {
    return this.request<void>({
      method: "DELETE",
      path: `/guilds/${guildId}/roles/${roleId}`,
    });
  }

  addMemberRole(guildId: string, memberId: string, roleId: string) {
    return this.request<void>({
      method: "PUT",
      path: `/guilds/${guildId}/members/${memberId}/roles/${roleId}`,
    });
  }

  removeMemberRole(guildId: string, memberId: string, roleId: string) {
    return this.request<void>({
      method: "DELETE",
      path: `/guilds/${guildId}/members/${memberId}/roles/${roleId}`,
    });
  }

  kickGuildMember(guildId: string, memberId: string) {
    return this.request<void>({
      method: "DELETE",
      path: `/guilds/${guildId}/members/${memberId}`,
    });
  }

  updateGuildMember(guildId: string, memberId: string, payload: { nick: string | null }) {
    return this.request<DiscordGuildMember>({
      method: "PATCH",
      path: `/guilds/${guildId}/members/${memberId}`,
      body: payload,
    });
  }



  listGuildChannels(guildId: string) {
    return this.request<DiscordGuildChannel[]>({
      method: "GET",
      path: `/guilds/${guildId}/channels`,
    });
  }

  createChannelMessage(channelId: string, content: string) {
    return this.request<void>({
      method: "POST",
      path: `/channels/${channelId}/messages`,
      body: { content },
    });
  }

  getCurrentBotUser() {
    return this.request<DiscordUser>({
      method: "GET",
      path: "/users/@me",
    });
  }

  createGuildChannel(guildId: string, payload: CreateGuildChannelPayload) {
    return this.request<DiscordGuildChannel>({
      method: "POST",
      path: `/guilds/${guildId}/channels`,
      body: payload,
    });
  }

  deleteChannel(channelId: string) {
    return this.request<void>({
      method: "DELETE",
      path: `/channels/${channelId}`,
    });
  }

  updateGuildChannel(channelId: string, payload: UpdateGuildChannelPayload) {
    return this.request<DiscordGuildChannel>({
      method: "PATCH",
      path: `/channels/${channelId}`,
      body: payload,
    });
  }
}

let cachedGuildMemberIds: {
  guildId: string;
  ids: Set<string>;
  fetchedAtMs: number;
} | null = null;

/**
 * Returns the set of Discord user IDs that are currently members of the guild,
 * or null when Discord is not configured or the lookup fails. Used to tell whether
 * a website user who connected their Discord account has actually joined the server.
 *
 * The lookup pages through every guild member with sequential rate-limited
 * Discord REST calls, so callers that tolerate slightly stale data can pass
 * maxAgeMs to reuse the last successful result within that window.
 */
/**
 * Guild members with their role ids. Used by the live-class cleanup to work out
 * everyone who is permitted inside a live voice channel — deleting one requires
 * proving nobody is in it, and that proof is only as good as the candidate list.
 * Returns null when the guild cannot be read, which callers must treat as
 * "unknown", never as "empty".
 */
export const fetchDiscordGuildMembersWithRoles = async (): Promise<
  { id: string; roles: string[] }[] | null
> => {
  const discordBotToken = String(process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const discordGuildId = String(process.env.DISCORD_GUILD_ID ?? "").trim();

  if (!discordBotToken || !discordGuildId) {
    return null;
  }

  try {
    const apiClient = new DiscordApiClient(discordBotToken);
    const members = await apiClient.listGuildMembers(discordGuildId);
    return members
      .map((member) => ({
        id: String(member.user?.id ?? ""),
        roles: Array.isArray(member.roles) ? member.roles.map(String) : [],
      }))
      .filter((member) => member.id);
  } catch {
    return null;
  }
};

export const fetchDiscordGuildMemberIds = async (options?: {
  maxAgeMs?: number;
}): Promise<Set<string> | null> => {
  const discordBotToken = String(process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const discordGuildId = String(process.env.DISCORD_GUILD_ID ?? "").trim();

  if (!discordBotToken || !discordGuildId) {
    return null;
  }

  const maxAgeMs = options?.maxAgeMs ?? 0;
  if (
    cachedGuildMemberIds &&
    cachedGuildMemberIds.guildId === discordGuildId &&
    Date.now() - cachedGuildMemberIds.fetchedAtMs < maxAgeMs
  ) {
    return cachedGuildMemberIds.ids;
  }

  try {
    const apiClient = new DiscordApiClient(discordBotToken);
    const members = await apiClient.listGuildMembers(discordGuildId);
    const memberIds = new Set<string>();
    for (const member of members) {
      const memberId = member.user?.id;
      if (memberId) {
        memberIds.add(memberId);
      }
    }
    cachedGuildMemberIds = {
      guildId: discordGuildId,
      ids: memberIds,
      fetchedAtMs: Date.now(),
    };
    return memberIds;
  } catch {
    return null;
  }
};

const findRoleByName = (roles: DiscordRole[], name: string) => {
  const lowerName = name.toLowerCase();
  return (
    roles.find(
      (role) => !role.managed && role.name.toLowerCase() === lowerName
    ) ?? null
  );
};

const findCategoryByName = (channels: DiscordGuildChannel[], name: string) => {
  const lowerName = name.toLowerCase();
  return (
    channels.find(
      (channel) =>
        channel.type === discordCategoryChannelType &&
        channel.name.toLowerCase() === lowerName
    ) ?? null
  );
};

const findChannelByNameAndType = (
  channels: DiscordGuildChannel[],
  name: string,
  channelType: number
) => {
  const targetName = name.toLowerCase();
  return (
    channels
      .filter(
        (channel) =>
          channel.type === channelType &&
          channel.name.toLowerCase() === targetName
      )
      .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null
  );
};

const findFundraiserVoiceChannel = (
  channels: DiscordGuildChannel[],
  expectedName: string | null,
  excludedChannelIds: Set<string>
) => {
  if (expectedName) {
    const exact = channels.find(
      (channel) =>
        channel.type === discordVoiceChannelType &&
        channel.name === expectedName &&
        !excludedChannelIds.has(channel.id)
    );
    if (exact) {
      return exact;
    }
  }

  return (
    channels
      .filter(
        (channel) =>
          channel.type === discordVoiceChannelType &&
          fundraiserVoiceChannelNamePattern.test(channel.name) &&
          !excludedChannelIds.has(channel.id)
      )
      .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null
  );
};

const findCourseChannel = (
  channels: DiscordGuildChannel[],
  courseId: string,
  expectedName: string,
  usedChannelIds: Set<string>
) => {
  const byTopic =
    channels.find(
      (channel) =>
        channel.type === discordTextChannelType &&
        readCourseIdFromTopic(channel.topic).id === courseId &&
        !usedChannelIds.has(channel.id)
    ) ?? null;
  if (byTopic) {
    return byTopic;
  }

  const byNameCandidates = channels
    .filter((channel) => {
      if (
        channel.type !== discordTextChannelType ||
        usedChannelIds.has(channel.id)
      ) {
        return false;
      }

      if (channel.name !== expectedName) {
        return false;
      }

      // Only allow matching by name if the channel has no course ID in its topic,
      // or if the topic already matches this specific course ID. This prevents
      // a new course with the same name from hijacking an existing course's channel.
      const { id: existingTopicCourseId } = readCourseIdFromTopic(channel.topic);
      return !existingTopicCourseId || existingTopicCourseId === courseId;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return byNameCandidates[0] ?? null;
};

const isHumanMember = (member: DiscordGuildMember) =>
  Boolean(member.user?.id && member.user.username && !member.user.bot);

const getRoleIdsFromOverwrites = (
  channel: DiscordGuildChannel,
  guildId: string
) =>
  (channel.permission_overwrites ?? [])
    .filter((overwrite) => overwrite.type === 0 && overwrite.id !== guildId)
    .map((overwrite) => overwrite.id);

const buildZeroResult = (
  enabled: boolean,
  skippedReason: string | null
): DiscordSyncResult => ({
  enabled,
  skippedReason,
  kickedMemberCount: 0,
  createdCategoryCount: 0,
  createdRoleCount: 0,
  createdCourseRoleCount: 0,
  baseRoleAddedCount: 0,
  baseRoleRemovedCount: 0,
  courseRoleAddedCount: 0,
  courseRoleRemovedCount: 0,
  createdChannelCount: 0,
  updatedChannelCount: 0,
  deletedChannelCount: 0,
  deletedCourseRoleCount: 0,
  updatedMemberNickCount: 0,

  errors: [],
});

export const runDiscordSync = async ({
  adminClient,
}: DiscordSyncParams): Promise<DiscordSyncResult> => {
  const discordBotToken = String(process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const discordGuildId = String(process.env.DISCORD_GUILD_ID ?? "").trim();
  const coursesCategoryName =
    String(process.env.DISCORD_COURSES_CATEGORY_NAME ?? "").trim() ||
    defaultCoursesCategoryName;
  const textCategoryName =
    String(process.env.DISCORD_TEXT_CATEGORY_NAME ?? "").trim() ||
    defaultTextCategoryName;
  const voiceCategoryName =
    String(process.env.DISCORD_VOICE_CATEGORY_NAME ?? "").trim() ||
    defaultVoiceCategoryName;
  // Temporary live-class voice channels live under this category. It is created and
  // managed by the class-reminders cron; this name must match that cron's value.
  const liveCategoryName = "Live";
  const infoChannelName =
    String(process.env.DISCORD_INFO_CHANNEL_NAME ?? "").trim() ||
    defaultInfoChannelName;
  const tasksChannelName =
    String(process.env.DISCORD_TASKS_CHANNEL_NAME ?? "").trim() ||
    defaultTasksChannelName;
  const commitsChannelName =
    String(process.env.DISCORD_COMMITS_CHANNEL_NAME ?? "").trim() ||
    defaultCommitsChannelName;
  const readmeChannelName =
    String(process.env.DISCORD_README_CHANNEL_NAME ?? "")
      .trim()
      .toLowerCase() ||
    String(process.env.DISCORD_NOTICE_CHANNEL_NAME ?? "")
      .trim()
      .toLowerCase() ||
    defaultReadmeChannelName;
  const websiteVoiceChannelName =
    String(process.env.DISCORD_URL_VOICE_CHANNEL_NAME ?? "").trim() ||
    defaultWebsiteVoiceChannelName;

  const everyoneChatChannelName =
    String(process.env.DISCORD_EVERYONE_CHANNEL_NAME ?? "").trim() ||
    defaultEveryoneChatChannelName;
  const foundersOnlyChannelName =
    String(process.env.DISCORD_FOUNDERS_ONLY_CHANNEL_NAME ?? "").trim() ||
    defaultFoundersOnlyChannelName;
  const executivesOnlyChannelName =
    String(process.env.DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME ?? "").trim() ||
    defaultExecutivesOnlyChannelName;
  const socialMediaChannelName = String(process.env.DISCORD_SOCIAL_MEDIA_CHANNEL_NAME ?? "").trim() || defaultSocialMediaChannelName;
  const scienceTutorsChannelName = String(process.env.DISCORD_SCIENCE_TUTORS_CHANNEL_NAME ?? "").trim() || defaultScienceTutorsChannelName;
  const mathTutorsChannelName = String(process.env.DISCORD_MATH_TUTORS_CHANNEL_NAME ?? "").trim() || defaultMathTutorsChannelName;
  const everyoneVoiceChannelName = String(process.env.DISCORD_EVERYONE_VOICE_CHANNEL_NAME ?? "").trim() || defaultEveryoneVoiceChannelName;
  const executivesVoiceChannelName = String(process.env.DISCORD_EXECUTIVES_VOICE_CHANNEL_NAME ?? "").trim() || defaultExecutivesVoiceChannelName;
  const socialMediaVoiceChannelName = String(process.env.DISCORD_SOCIAL_MEDIA_VOICE_CHANNEL_NAME ?? "").trim() || defaultSocialMediaVoiceChannelName;
  const scienceTutorsVoiceChannelName = String(process.env.DISCORD_SCIENCE_TUTORS_VOICE_CHANNEL_NAME ?? "").trim() || defaultScienceTutorsVoiceChannelName;
  const mathTutorsVoiceChannelName = String(process.env.DISCORD_MATH_TUTORS_VOICE_CHANNEL_NAME ?? "").trim() || defaultMathTutorsVoiceChannelName;
  const nonprofitTeamChannelName = String(process.env.DISCORD_NONPROFIT_TEAM_CHANNEL_NAME ?? "").trim() || defaultNonprofitTeamChannelName;
  const nonprofitTeamVoiceChannelName = String(process.env.DISCORD_NONPROFIT_TEAM_VOICE_CHANNEL_NAME ?? "").trim() || defaultNonprofitTeamVoiceChannelName;
  const developmentTeamChannelName = String(process.env.DISCORD_DEVELOPMENT_TEAM_CHANNEL_NAME ?? "").trim() || defaultDevelopmentTeamChannelName;
  const developmentTeamVoiceChannelName = String(process.env.DISCORD_DEVELOPMENT_TEAM_VOICE_CHANNEL_NAME ?? "").trim() || defaultDevelopmentTeamVoiceChannelName;

  const protectedRoleNames = new Set(
    String(process.env.DISCORD_PROTECTED_ROLE_NAMES ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!discordBotToken || !discordGuildId) {
    return buildZeroResult(
      false,
      "Discord sync skipped: missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID."
    );
  }

  const result = buildZeroResult(true, null);
  const apiClient = new DiscordApiClient(discordBotToken);

  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: decayingUsers } = await adminClient
      .from("app_users")
      .select("id, strike_count, last_strike_at")
      .gt("strike_count", 0)
      .lte("last_strike_at", threeMonthsAgo.toISOString());

    if (decayingUsers && decayingUsers.length > 0) {
      for (const targetUser of decayingUsers) {
        await adminClient
          .from("app_users")
          .update({
            strike_count: 0,
            last_strike_at: null,
          })
          .eq("id", targetUser.id);
      }
    }
  } catch (error) {
    result.errors.push(`Failed to decay strikes: ${toErrorMessage(error, "Unknown auto-decay error.")}`);
  }

  const [{ data: users, error: usersError }, { data: courses, error: coursesError }, { data: enrollments, error: enrollmentsError }, { data: approvedAccounts, error: approvedAccountsError }] =
    await Promise.all([
      adminClient
        .from("app_users")
        .select("id, email, full_name, role, discord_user_id, is_junior, strike_count, custom_roles(name, role_level)")
        .not("email_verified_at", "is", null),
      adminClient
        .from("courses")
        .select("id, title, is_completed, created_by, co_tutor_id, created_by_name, created_by_email, created_at, course_classes(starts_at, duration_hours)")
        .is("deleted_at", null),
      adminClient
        .from("course_enrollments")
        .select("course_id, student_id"),
      adminClient
        .from("approved_discord_accounts")
        .select("discord_user_id, owner_user_id"),
    ]);

  if (usersError) {
    throw new Error(usersError.message ?? "Failed to load users for Discord sync.");
  }
  if (coursesError) {
    throw new Error(coursesError.message ?? "Failed to load courses for Discord sync.");
  }
  if (enrollmentsError) {
    throw new Error(
      enrollmentsError.message ?? "Failed to load enrollments for Discord sync."
    );
  }
  if (approvedAccountsError) {
    // Abort rather than fall back to an empty list: running without the
    // approved list would kick every approved account from the guild.
    throw new Error(
      approvedAccountsError.message ??
      "Failed to load approved Discord accounts for Discord sync."
    );
  }

  const websiteUsers = (users ?? []) as WebsiteUserRow[];
  const websiteCourses = (courses ?? []) as CourseRow[];
  const websiteEnrollments = (enrollments ?? []) as CourseEnrollmentRow[];
  const nowMs = Date.now();
  const endedAtMsByCourseId = new Map<string, number>();
  for (const course of websiteCourses) {
    endedAtMsByCourseId.set(course.id, getCourseEndedAtMs(course));
  }

  const approvedAccountRows = (approvedAccounts ?? []) as ApprovedDiscordAccountRow[];
  const approvedDiscordUserIds = new Set<string>();
  const approvedAccountIdsByOwnerUserId = new Map<string, string[]>();
  for (const account of approvedAccountRows) {
    const accountDiscordUserId = String(account.discord_user_id ?? "").trim();
    if (!accountDiscordUserId) {
      continue;
    }
    approvedDiscordUserIds.add(accountDiscordUserId);

    const ownerUserId = String(account.owner_user_id ?? "").trim();
    if (ownerUserId) {
      const ownedIds = approvedAccountIdsByOwnerUserId.get(ownerUserId) ?? [];
      ownedIds.push(accountDiscordUserId);
      approvedAccountIdsByOwnerUserId.set(ownerUserId, ownedIds);
    }
  }

  const websiteUserByDiscordUserId = new Map<string, WebsiteUserRow>();

  for (const user of websiteUsers) {
    const discordUserId = String(user.discord_user_id ?? "").trim();
    if (!discordUserId) {
      continue;
    }

    if (websiteUserByDiscordUserId.has(discordUserId)) {
      result.errors.push(
        `Duplicate website Discord user id "${discordUserId}" detected.`
      );
      continue;
    }
    websiteUserByDiscordUserId.set(discordUserId, user);
  }

  const [botUser, guildMembers, guildRoles, guildChannels] = await Promise.all([
    apiClient.getCurrentBotUser(),
    apiClient.listGuildMembers(discordGuildId),
    apiClient.listGuildRoles(discordGuildId),
    apiClient.listGuildChannels(discordGuildId),
  ]);

  const mutableRoles = [...guildRoles];
  const mutableChannels = [...guildChannels];
  const fundraiserRaisedAmount = await fetchFundraisingRaisedAmount();
  const fundraiserVoiceChannelName =
    typeof fundraiserRaisedAmount === "number"
      ? `$${fundraiserRaisedAmount.toLocaleString("en-US")} raised`
      : null;

  const ensureRole = async (name: string, isCourseRole: boolean) => {
    const existing = findRoleByName(mutableRoles, name);
    if (existing) {
      return existing;
    }
    const createdRole = await apiClient.createGuildRole(discordGuildId, name);
    mutableRoles.push(createdRole);
    result.createdRoleCount += 1;
    if (isCourseRole) {
      result.createdCourseRoleCount += 1;
    }
    return createdRole;
  };

  const ensureCategory = async (name: string) => {
    const existing = findCategoryByName(mutableChannels, name);
    if (existing) {
      return existing;
    }
    const created = await apiClient.createGuildChannel(discordGuildId, {
      name,
      type: discordCategoryChannelType,
    });
    mutableChannels.push(created);
    result.createdCategoryCount += 1;
    return created;
  };

  const ceoRole = await ensureRole("CEO", false);
  const cooRole = await ensureRole("COO", false);
  const chiefExecutiveRole = await ensureRole("Chief Executive", false);
  const studentRole = await ensureRole("Student", false);
  const executiveRole = await ensureRole("Executive", false);
  const juniorExecutiveRole = await ensureRole("Junior Executive", false);
  const socialMediaRole = await ensureRole("Social Media", false);
  const scienceTutorsRole = await ensureRole("Science Tutor", false);
  const mathTutorsRole = await ensureRole("Math Tutor", false);
  const nonprofitTeamRole = await ensureRole("Nonprofit Team", false);
  const developmentTeamRole = await ensureRole("Development Team", false);
  const founderRole = await ensureRole("Founder", false);
  const strikeRole = await ensureRole("Strike", false);

  const baseRoleIds = new Set([
    ceoRole.id,
    cooRole.id,
    chiefExecutiveRole.id,
    studentRole.id,
    executiveRole.id,
    juniorExecutiveRole.id,
    founderRole.id,
    socialMediaRole.id,
    scienceTutorsRole.id,
    mathTutorsRole.id,
    nonprofitTeamRole.id,
    developmentTeamRole.id,
    strikeRole.id,
  ]);
  const founderDiscordUserIds = new Set(
    websiteUsers
      .filter((user) => {
        const email = String(user.email ?? "").trim().toLowerCase();
        return founderEmails.some(f => f.toLowerCase() === email);
      })
      .map((user) => user.discord_user_id)
      .filter((id): id is string => Boolean(id))
  );

  const humanMembers = guildMembers.filter(isHumanMember);
  const memberRoleSetByDiscordUserId = new Map<string, Set<string>>();
  const websiteUserByDiscordMemberId = new Map<string, WebsiteUserRow>();
  const websiteMemberIds = new Set<string>();
  const kickedMemberIds = new Set<string>();

  for (const member of humanMembers) {
    const memberUserId = member.user?.id ?? "";
    if (!memberUserId) {
      continue;
    }

    memberRoleSetByDiscordUserId.set(memberUserId, new Set(member.roles ?? []));
    const websiteUser = websiteUserByDiscordUserId.get(memberUserId);

    if (!websiteUser) {
      if (approvedDiscordUserIds.has(memberUserId)) {
        // Approved extra account (e.g. a tutor's second account for lesson
        // calls): allowed to stay without a linked website user. Base role and
        // nickname management do not apply; course roles are mirrored from the
        // owner in the course role loop below.
        continue;
      }
      try {
        await apiClient.kickGuildMember(discordGuildId, memberUserId);
        result.kickedMemberCount += 1;
        kickedMemberIds.add(memberUserId);
      } catch (error) {
        result.errors.push(
          `Failed to kick member ${member.user?.username ?? memberUserId}: ${toErrorMessage(
            error,
            "Unknown kick error."
          )}`
        );
      }
      continue;
    }

    websiteUserByDiscordMemberId.set(memberUserId, websiteUser);
    websiteMemberIds.add(memberUserId);
  }

  const addRoleToMember = async (
    memberId: string,
    roleId: string,
    roleSet: Set<string>,
    counterKey:
      | "baseRoleAddedCount"
      | "baseRoleRemovedCount"
      | "courseRoleAddedCount"
      | "courseRoleRemovedCount",
    remove = false
  ) => {
    try {
      if (remove) {
        await apiClient.removeMemberRole(discordGuildId, memberId, roleId);
        roleSet.delete(roleId);
      } else {
        await apiClient.addMemberRole(discordGuildId, memberId, roleId);
        roleSet.add(roleId);
      }
      result[counterKey] += 1;
    } catch (error) {
      result.errors.push(
        `Failed to ${remove ? "remove" : "add"} role ${roleId} for member ${memberId}: ${toErrorMessage(
          error,
          "Unknown role update error."
        )}`
      );
    }
  };

  const customRoleIds = new Set<string>();

  const isCustomOrgRoleName = (name: string) => {
    const lowerName = name.trim().toLowerCase();
    const isOrgRole = ["ceo", "coo", "executive", "founder", "student", "tutor", "team", "media", "strike"].some(
      (keyword) => lowerName.includes(keyword)
    );
    const isActuallyCourseRole = !isOrgRole || websiteCourses.some((course) => {
      const baseName = normalizeRoleName(course.title, course.id);
      return lowerName === baseName.trim().toLowerCase();
    });
    return !isActuallyCourseRole;
  };

  // Resolve every linked member's custom roles into customRoleIds BEFORE the
  // per-member pass. The removal branch below needs the complete set: when it
  // was built incrementally inside the same loop, a role revoked from a member
  // processed before the remaining holders was never removed. Only existing
  // guild roles matter here (a role that doesn't exist can't be held); role
  // creation still happens in the per-member pass.
  for (const member of humanMembers) {
    const memberId = member.user?.id ?? "";
    if (!memberId || !websiteMemberIds.has(memberId)) {
      continue;
    }
    const websiteUser = websiteUserByDiscordMemberId.get(memberId);
    if (!websiteUser) {
      continue;
    }
    const userCustomRoles = Array.isArray(websiteUser.custom_roles)
      ? websiteUser.custom_roles
      : [websiteUser.custom_roles].filter(Boolean);
    for (const r of userCustomRoles) {
      if (!r?.name) {
        continue;
      }
      if (r.role_level !== "Chief Executive" && !isCustomOrgRoleName(r.name)) {
        continue;
      }
      const existing = findRoleByName(mutableRoles, r.name.trim());
      if (existing) {
        customRoleIds.add(existing.id);
      }
    }
  }

  for (const member of humanMembers) {
    const memberId = member.user?.id ?? "";
    if (!memberId || !websiteMemberIds.has(memberId)) {
      continue;
    }

    const roleSet = memberRoleSetByDiscordUserId.get(memberId);
    const websiteUser = websiteUserByDiscordMemberId.get(memberId);
    if (!roleSet || !websiteUser) {
      continue;
    }

    const requiredBaseRoleIds = new Set<string>();

    const userCustomRoles = Array.isArray(websiteUser.custom_roles)
      ? websiteUser.custom_roles
      : [websiteUser.custom_roles].filter(Boolean);

    for (const r of userCustomRoles) {
      if (r && r.role_level === "Chief Executive" && r.name) {
        const customRole = await ensureRole(r.name.trim(), false);
        requiredBaseRoleIds.add(customRole.id);
        customRoleIds.add(customRole.id);
      }
    }

    const customRoleNames = Array.isArray(websiteUser.custom_roles)
      ? websiteUser.custom_roles.map((r) => r.name).filter(Boolean)
      : [websiteUser.custom_roles?.name].filter((name): name is string => Boolean(name));
    const customRoleLevels = Array.isArray(websiteUser.custom_roles)
      ? websiteUser.custom_roles.map((r) => r.role_level).filter(Boolean)
      : [websiteUser.custom_roles?.role_level].filter((level): level is string => Boolean(level));

    const websiteRole = resolveUserRole(websiteUser.email, websiteUser.role, customRoleLevels);
    const isHardcodedFounder = founderDiscordUserIds.has(memberId) && customRoleLevels.length === 0;

    let primaryHierarchyRoleId = studentRole.id;
    if (isHardcodedFounder || websiteRole === "founder") primaryHierarchyRoleId = founderRole.id;
    else if (websiteRole === "CEO") primaryHierarchyRoleId = ceoRole.id;
    else if (websiteRole === "COO") primaryHierarchyRoleId = cooRole.id;
    else if (websiteRole === "Chief Executive") primaryHierarchyRoleId = chiefExecutiveRole.id;
    else if (websiteRole === "Executive" || websiteRole === "executive") primaryHierarchyRoleId = websiteUser.is_junior ? juniorExecutiveRole.id : executiveRole.id;
    else if (websiteRole === "Junior Executive") primaryHierarchyRoleId = juniorExecutiveRole.id;

    requiredBaseRoleIds.add(primaryHierarchyRoleId);

    if (websiteRole === "Chief Executive") {
      requiredBaseRoleIds.add(chiefExecutiveRole.id);
      requiredBaseRoleIds.add(executiveRole.id);
    }

    for (const name of customRoleNames) {
      if (!isCustomOrgRoleName(name)) {
        continue;
      }

      const customRole = await ensureRole(name, false);
      requiredBaseRoleIds.add(customRole.id);
      customRoleIds.add(customRole.id);
    }

    const hierarchyRoleIds = [
      ceoRole.id, cooRole.id, chiefExecutiveRole.id, founderRole.id,
      executiveRole.id, juniorExecutiveRole.id, studentRole.id
    ];

    const isExecTier = [ceoRole.id, cooRole.id, chiefExecutiveRole.id, executiveRole.id, juniorExecutiveRole.id].some(id => requiredBaseRoleIds.has(id));
    // Discord caps server nicknames at 32 characters; compare the clamped
    // value so over-long names don't fail (and retry) on every run.
    const rawExpectedNick = primaryHierarchyRoleId !== studentRole.id ? null : (websiteUser.full_name || null);
    const expectedNick = rawExpectedNick ? rawExpectedNick.slice(0, 32) : null;

    if (expectedNick !== (member.nick ?? null)) {
      try {
        await apiClient.updateGuildMember(discordGuildId, memberId, { nick: expectedNick });
        result.updatedMemberNickCount += 1;
      } catch (error) {
        result.errors.push(
          `Failed to update nickname for member ${memberId}: ${toErrorMessage(
            error,
            "Unknown update member error."
          )}`
        );
      }
    }

    for (const roleId of requiredBaseRoleIds) {
      if (!roleSet.has(roleId)) {
        await addRoleToMember(memberId, roleId, roleSet, "baseRoleAddedCount");
      }
    }

    for (const rId of hierarchyRoleIds) {
      if (!requiredBaseRoleIds.has(rId) && roleSet.has(rId)) {
        await addRoleToMember(memberId, rId, roleSet, "baseRoleRemovedCount", true);
      }
    }

    // Covers Chief Executive custom roles and every other website-managed
    // custom role: anything in the (complete) set the member holds but no
    // longer requires was revoked on the website.
    for (const rId of customRoleIds) {
      if (!requiredBaseRoleIds.has(rId) && roleSet.has(rId)) {
        await addRoleToMember(memberId, rId, roleSet, "baseRoleRemovedCount", true);
      }
    }

    if (isExecTier) {
      const strikeCount = websiteUser.strike_count || 0;
      if (strikeCount > 0) {
        if (!roleSet.has(strikeRole.id)) {
          await addRoleToMember(memberId, strikeRole.id, roleSet, "baseRoleAddedCount");
        }
      } else if (roleSet.has(strikeRole.id)) {
        await addRoleToMember(memberId, strikeRole.id, roleSet, "baseRoleRemovedCount", true);
      }
    } else {
      if (roleSet.has(strikeRole.id)) {
        await addRoleToMember(memberId, strikeRole.id, roleSet, "baseRoleRemovedCount", true);
      }
    }
  }

  const enrollmentsByCourseId = new Map<string, Set<string>>();
  for (const enrollment of websiteEnrollments) {
    const courseId = String(enrollment.course_id ?? "").trim();
    const studentId = String(enrollment.student_id ?? "").trim();
    if (!courseId || !studentId) {
      continue;
    }
    const current = enrollmentsByCourseId.get(courseId) ?? new Set<string>();
    current.add(studentId);
    enrollmentsByCourseId.set(courseId, current);
  }

  const createCourseRole = async (course: CourseRow) => {
    const baseName = normalizeRoleName(course.title, course.id);
    const uniqueName = buildUniqueCourseRoleName(baseName, course.id, mutableRoles);

    const existing = findRoleByName(mutableRoles, uniqueName);
    if (existing) {
      return existing;
    }

    const createdRole = await apiClient.createGuildRole(discordGuildId, uniqueName);
    mutableRoles.push(createdRole);
    result.createdRoleCount += 1;
    result.createdCourseRoleCount += 1;
    return createdRole;
  };

  const websiteCourseById = new Map(
    websiteCourses.map((course) => [course.id, course] as const)
  );

  const courseRoleIdFromManagedChannelByCourseId = new Map<string, string>();
  const courseIdsWithManagedChannels = new Set<string>();
  for (const channel of mutableChannels) {
    if (channel.type !== discordTextChannelType) {
      continue;
    }

    const { id: courseId } = readCourseIdFromTopic(channel.topic);
    if (!courseId) {
      continue;
    }

    courseIdsWithManagedChannels.add(courseId);
    if (courseRoleIdFromManagedChannelByCourseId.has(courseId)) {
      continue;
    }

    const course = websiteCourseById.get(courseId);
    let candidateRoleId: string | undefined;

    if (course) {
      const baseName = normalizeRoleName(course.title, course.id).trim().toLowerCase();
      const suffixSeed = getCourseRoleSuffix(course.id).toLowerCase();

      const candidateRoles = getRoleIdsFromOverwrites(channel, discordGuildId)
        .filter((roleId) => {
          if (baseRoleIds.has(roleId)) {
            return false;
          }
          const role = mutableRoles.find((item) => item.id === roleId);
          return Boolean(role && !role.managed);
        })
        .map((roleId) => {
          const role = mutableRoles.find((item) => item.id === roleId)!;
          const roleNameLower = role.name.trim().toLowerCase();
          let score = 0;
          if (roleNameLower.includes(`(${suffixSeed}`)) {
            score = 2; // Perfect match with suffix seed
          } else if (roleNameLower === baseName) {
            score = 1; // Match with base name
          }
          return { roleId, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      candidateRoleId = candidateRoles[0]?.roleId;
    } else {
      candidateRoleId = getRoleIdsFromOverwrites(channel, discordGuildId)
        .filter((roleId) => {
          if (baseRoleIds.has(roleId)) {
            return false;
          }
          const role = mutableRoles.find((item) => item.id === roleId);
          return Boolean(role && !role.managed);
        })
        .sort((left, right) => left.localeCompare(right))[0];
    }

    if (candidateRoleId) {
      courseRoleIdFromManagedChannelByCourseId.set(courseId, candidateRoleId);
    }
  }
  const courseRoleIdByCourseId = new Map<string, string>();
  for (const course of websiteCourses) {
    const endedAtMs = endedAtMsByCourseId.get(course.id) ?? Number.POSITIVE_INFINITY;
    const isPastDeletionDelay = nowMs >= endedAtMs + deletionDelayMs;

    if (isPastDeletionDelay) {
      continue;
    }

    const existingRoleId = courseRoleIdFromManagedChannelByCourseId.get(course.id);
    if (existingRoleId) {
      courseRoleIdByCourseId.set(course.id, existingRoleId);
      continue;
    }

    const role = await createCourseRole(course);
    courseRoleIdByCourseId.set(course.id, role.id);
  }

  const courseIdsByRoleId = new Map<string, string[]>();
  for (const [courseId, roleId] of courseRoleIdByCourseId) {
    const current = courseIdsByRoleId.get(roleId) ?? [];
    current.push(courseId);
    courseIdsByRoleId.set(roleId, current);
  }

  for (const courseIds of courseIdsByRoleId.values()) {
    if (courseIds.length <= 1) {
      continue;
    }

    const sortedCourseIds = [...courseIds].sort((left, right) =>
      left.localeCompare(right)
    );

    for (let index = 1; index < sortedCourseIds.length; index += 1) {
      const courseId = sortedCourseIds[index];
      const course = websiteCourseById.get(courseId);
      if (!course) {
        continue;
      }

      const replacementRole = await createCourseRole(course);
      courseRoleIdByCourseId.set(courseId, replacementRole.id);
    }
  }

  // Ensure Categories are fetched/created early so we can sort channels by position in "Courses" category
  const textCategory = await ensureCategory(textCategoryName);
  const voiceCategory = await ensureCategory(voiceCategoryName);
  const coursesCategory = await ensureCategory(coursesCategoryName);

  // Keep course role names synchronized with course titles, while gracefully
  // handling duplicate course titles by assigning deterministic suffixes.
  const activeCourseIdSet = new Set(
    websiteCourses
      .filter((course) => {
        const endedAtMs = endedAtMsByCourseId.get(course.id) ?? Number.POSITIVE_INFINITY;
        return nowMs < endedAtMs + deletionDelayMs;
      })
      .map((course) => course.id)
  );

  const expectedCourseRoleIdSet = new Set(
    Array.from(courseRoleIdByCourseId.entries())
      .filter(([courseId]) => activeCourseIdSet.has(courseId))
      .map(([, roleId]) => roleId)
  );
  const activeRoles = mutableRoles.filter((role) => {
    if (baseRoleIds.has(role.id) || customRoleIds.has(role.id)) {
      return true;
    }
    return expectedCourseRoleIdSet.has(role.id);
  });

  const getCourseChannelPosition = (courseId: string): number => {
    const channel = mutableChannels.find(
      (c) =>
        c.type === discordTextChannelType &&
        c.parent_id === coursesCategory.id &&
        readCourseIdFromTopic(c.topic).id === courseId
    );
    return channel && typeof channel.position === "number" ? channel.position : Number.MAX_SAFE_INTEGER;
  };

  const isLimboCourse = (course: CourseRow): boolean => {
    return !course.created_by_name && !course.created_by_email;
  };

  const isOngoingCourse = (course: CourseRow, nowTimeMs: number): boolean => {
    if (course.is_completed) {
      return false;
    }
    if (isLimboCourse(course)) {
      return false;
    }
    const classRows = Array.isArray(course.course_classes) ? course.course_classes : [];
    const hasActive = classRows.some((item) => {
      const startsAt = new Date(item.starts_at).getTime();
      if (!Number.isFinite(startsAt)) {
        return false;
      }
      return classEndMs(startsAt, item.duration_hours) >= nowTimeMs;
    });
    return hasActive;
  };

  const compareOngoingOldestFirst = (a: CourseRow, b: CourseRow) => {
    const getFirstClassTime = (course: CourseRow) => {
      const classRows = Array.isArray(course.course_classes) ? course.course_classes : [];
      const allClasses = classRows
        .map((item) => new Date(item.starts_at).getTime())
        .filter((value) => Number.isFinite(value));
      if (allClasses.length > 0) {
        return Math.min(...allClasses);
      }
      return Number.NEGATIVE_INFINITY;
    };

    const aFirst = getFirstClassTime(a);
    const bFirst = getFirstClassTime(b);

    if (aFirst !== bFirst) {
      return aFirst - bFirst; // Earliest start time first
    }

    const aCreated = a.created_at ? new Date(a.created_at).getTime() : Number.NEGATIVE_INFINITY;
    const bCreated = b.created_at ? new Date(b.created_at).getTime() : Number.NEGATIVE_INFINITY;

    if (Number.isFinite(aCreated) && Number.isFinite(bCreated)) {
      if (aCreated !== bCreated) {
        return aCreated - bCreated; // Earliest creation date first
      }
    }

    return a.id.localeCompare(b.id);
  };

  const roleRenameCourseIds = Array.from(courseRoleIdByCourseId.keys())
    .filter((id) => activeCourseIdSet.has(id))
    .sort((idA, idB) => {
    const courseA = websiteCourseById.get(idA);
    const courseB = websiteCourseById.get(idB);

    if (courseA && courseB) {
      const baseNameA = normalizeRoleName(courseA.title, courseA.id).trim().toLowerCase();
      const baseNameB = normalizeRoleName(courseB.title, courseB.id).trim().toLowerCase();

      if (baseNameA === baseNameB) {
        const ongoingA = isOngoingCourse(courseA, nowMs);
        const ongoingB = isOngoingCourse(courseB, nowMs);

        if (ongoingA && !ongoingB) {
          return -1;
        }
        if (!ongoingA && ongoingB) {
          return 1;
        }
        return compareOngoingOldestFirst(courseA, courseB);
      }
    }

    const posA = getCourseChannelPosition(idA);
    const posB = getCourseChannelPosition(idB);
    if (posA !== posB) {
      return posA - posB;
    }
    return idA.localeCompare(idB);
  });

  const rolesBeingRenamed = new Set(
    roleRenameCourseIds
      .map((courseId) => courseRoleIdByCourseId.get(courseId))
      .filter((roleId): roleId is string => Boolean(roleId))
  );

  const finalizedRoles = activeRoles.filter((role) => !rolesBeingRenamed.has(role.id));

  for (const courseId of roleRenameCourseIds) {
    const course = websiteCourseById.get(courseId);
    const courseRoleId = courseRoleIdByCourseId.get(courseId);
    if (!course || !courseRoleId) {
      continue;
    }

    const role = mutableRoles.find((item) => item.id === courseRoleId);
    if (!role || role.managed) {
      continue;
    }

    const baseName = normalizeRoleName(course.title, course.id);
    const expectedRoleName = buildUniqueCourseRoleName(
      baseName,
      course.id,
      finalizedRoles,
      role.id
    );

    let finalRoleObj = role;
    if (role.name !== expectedRoleName) {
      try {
        const updatedRole = await apiClient.updateGuildRole(
          discordGuildId,
          role.id,
          { name: expectedRoleName }
        );
        const roleIndex = mutableRoles.findIndex((item) => item.id === role.id);
        if (roleIndex >= 0) {
          mutableRoles[roleIndex] = updatedRole;
        }
        const activeRoleIndex = activeRoles.findIndex((item) => item.id === role.id);
        if (activeRoleIndex >= 0) {
          activeRoles[activeRoleIndex] = updatedRole;
        }
        finalRoleObj = updatedRole;
      } catch (error) {
        result.errors.push(
          `Failed to rename course role "${role.name}" for course "${course.title}": ${toErrorMessage(
            error,
            "Unknown update role error."
          )}`
        );
      }
    }

    finalizedRoles.push(finalRoleObj);
  }

  const discordUserIdByWebsiteUserId = new Map<string, string>();
  for (const [discordUserId, websiteUser] of websiteUserByDiscordMemberId) {
    discordUserIdByWebsiteUserId.set(websiteUser.id, discordUserId);
  }

  for (const course of websiteCourses) {
    const courseRoleId = courseRoleIdByCourseId.get(course.id);
    if (!courseRoleId) {
      continue;
    }

    const expectedDiscordMemberIds = new Set<string>();
    // A website user expects the course role on their linked account and on any
    // approved extra accounts they own (e.g. a tutor's second lesson account).
    const addExpectedWebsiteUser = (userId: string) => {
      const discordUserId = discordUserIdByWebsiteUserId.get(userId);
      if (discordUserId) {
        expectedDiscordMemberIds.add(discordUserId);
      }
      for (const approvedId of approvedAccountIdsByOwnerUserId.get(userId) ?? []) {
        expectedDiscordMemberIds.add(approvedId);
      }
    };

    const tutorId = String(course.created_by ?? "").trim();
    if (tutorId) {
      addExpectedWebsiteUser(tutorId);
    }

    // Co-tutors teach the course too but are not enrolled as students, so they
    // need the course role through the same path as the primary tutor.
    const coTutorId = String(course.co_tutor_id ?? "").trim();
    if (coTutorId) {
      addExpectedWebsiteUser(coTutorId);
    }

    for (const studentId of enrollmentsByCourseId.get(course.id) ?? []) {
      addExpectedWebsiteUser(studentId);
    }

    for (const member of humanMembers) {
      const memberId = member.user?.id ?? "";
      if (!memberId || kickedMemberIds.has(memberId)) {
        continue;
      }

      const roleSet = memberRoleSetByDiscordUserId.get(memberId);
      if (!roleSet) {
        continue;
      }

      const shouldHaveRole = expectedDiscordMemberIds.has(memberId);
      const hasRole = roleSet.has(courseRoleId);

      if (shouldHaveRole && !hasRole) {
        await addRoleToMember(
          memberId,
          courseRoleId,
          roleSet,
          "courseRoleAddedCount"
        );
      } else if (!shouldHaveRole && hasRole) {
        await addRoleToMember(
          memberId,
          courseRoleId,
          roleSet,
          "courseRoleRemovedCount",
          true
        );
      }
    }
  }


  const staleCourseRoleIdCandidates = new Set<string>();

  for (const channel of [...mutableChannels]) {
    if (channel.type !== discordTextChannelType) {
      continue;
    }

    const { id: courseId } = readCourseIdFromTopic(channel.topic);
    if (!courseId || activeCourseIdSet.has(courseId)) {
      continue;
    }

    for (const roleId of getRoleIdsFromOverwrites(channel, discordGuildId)) {
      staleCourseRoleIdCandidates.add(roleId);
    }

    try {
      await apiClient.deleteChannel(channel.id);
      result.deletedChannelCount += 1;
      const channelIndex = mutableChannels.findIndex((item) => item.id === channel.id);
      if (channelIndex >= 0) {
        mutableChannels.splice(channelIndex, 1);
      }
    } catch (error) {
      result.errors.push(
        `Failed to delete stale course channel "${channel.name}": ${toErrorMessage(
          error,
          "Unknown delete channel error."
        )}`
      );
    }
  }

  // Also clean up orphan roles that are no longer tied to an active course.
  for (const role of mutableRoles) {
    if (role.managed || role.id === discordGuildId) {
      continue;
    }
    if (baseRoleIds.has(role.id) || expectedCourseRoleIdSet.has(role.id) || customRoleIds.has(role.id)) {
      continue;
    }
    if (protectedRoleNames.has(role.name.toLowerCase())) {
      continue;
    }
    staleCourseRoleIdCandidates.add(role.id);
  }

  for (const roleId of staleCourseRoleIdCandidates) {
    if (baseRoleIds.has(roleId) || expectedCourseRoleIdSet.has(roleId) || customRoleIds.has(roleId)) {
      continue;
    }

    const role = mutableRoles.find((item) => item.id === roleId);
    if (!role || role.managed) {
      continue;
    }

    const stillUsedByManagedCourseChannel = mutableChannels.some((channel) => {
      if (channel.type !== discordTextChannelType) {
        return false;
      }
      const { id: courseId } = readCourseIdFromTopic(channel.topic);
      if (!courseId) {
        return false;
      }
      const expectedRoleId = courseRoleIdByCourseId.get(courseId);
      if (!expectedRoleId || expectedRoleId !== roleId) {
        return false;
      }
      return getRoleIdsFromOverwrites(channel, discordGuildId).includes(roleId);
    });

    if (stillUsedByManagedCourseChannel) {
      continue;
    }

    try {
      await apiClient.deleteGuildRole(discordGuildId, roleId);
      result.deletedCourseRoleCount += 1;
      const roleIndex = mutableRoles.findIndex((item) => item.id === roleId);
      if (roleIndex >= 0) {
        mutableRoles.splice(roleIndex, 1);
      }
    } catch (error) {
      result.errors.push(
        `Failed to delete stale course role "${role.name}": ${toErrorMessage(
          error,
          "Unknown delete role error."
        )}`
      );
    }
  }




  // Ensure Courses category denies @everyone viewChannel so
  const privateCategoryOverwrites: DiscordPermissionOverwrite[] = [
    {
      id: discordGuildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
  ];

  for (const cat of [coursesCategory]) {
    if (!areOverwritesEqual(cat.permission_overwrites, privateCategoryOverwrites)) {
      try {
        const updated = await apiClient.updateGuildChannel(cat.id, {
          permission_overwrites: privateCategoryOverwrites,
        });
        const idx = mutableChannels.findIndex((c) => c.id === cat.id);
        if (idx !== -1) {
          mutableChannels[idx] = updated;
        }
        result.updatedChannelCount += 1;
      } catch (error) {
        result.errors.push(
          `Failed to update category "${cat.name}" permissions: ${toErrorMessage(error, "Unknown error")}`
        );
      }
    }
  }

  const usedChannelIds = new Set<string>();

  for (const course of websiteCourses) {
    const courseRoleId = courseRoleIdByCourseId.get(course.id);
    if (!courseRoleId) {
      continue;
    }

    const expectedChannelName = normalizeChannelName(course.title, course.id);
    const existingChannel = findCourseChannel(
      mutableChannels,
      course.id,
      expectedChannelName,
      usedChannelIds
    );

    const endedAtMs = endedAtMsByCourseId.get(course.id) ?? Number.POSITIVE_INFINITY;
    const { flags: currentFlags } = existingChannel ? readCourseIdFromTopic(existingChannel.topic) : { flags: "" };
    let nextFlags = currentFlags;

    const isPastEnd = nowMs >= endedAtMs;
    const isPastDeletionDelay = nowMs >= endedAtMs + deletionDelayMs;

    if (!isPastEnd && nextFlags.includes("w")) {
      nextFlags = nextFlags.replace(/w/g, "");
    }
    if (!isPastDeletionDelay && nextFlags.includes("a")) {
      nextFlags = nextFlags.replace(/a/g, "");
    }

    if (isPastEnd && !currentFlags.includes("w") && existingChannel) {
      try {
        await apiClient.createChannelMessage(
          existingChannel.id,
          `**The course has officially concluded!** <@&${courseRoleId}>\n\nThis channel will remain open for one more week to allow you to save any notes, resources, or final discussions.\n\n**Deletion Date:** in 7 days\nAfter this time, this channel and its corresponding role will be permanently deleted. Please make sure to save any important materials before then.`
        );
        nextFlags += "w";
      } catch (error) {
        result.errors.push(`Failed to send week notice for course "${course.title}": ${toErrorMessage(error, "Unknown error")}`);
      }
    }

    const expectedTopic = getCourseTopicMarker(course.id, nextFlags);
    const expectedParentId = coursesCategory.id;
    const expectedOverwrites = buildCoursePermissionOverwrites(
      discordGuildId,
      courseRoleId,
      executiveRole.id,
      juniorExecutiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    );


    if (!existingChannel) {
      try {
        const createdChannel = await apiClient.createGuildChannel(discordGuildId, {
          name: expectedChannelName,
          type: discordTextChannelType,
          topic: expectedTopic,
          parent_id: expectedParentId,
          permission_overwrites: expectedOverwrites,
        });
        mutableChannels.push(createdChannel);
        usedChannelIds.add(createdChannel.id);
        result.createdChannelCount += 1;
      } catch (error) {
        result.errors.push(
          `Failed to create channel for course "${course.title}": ${toErrorMessage(
            error,
            "Unknown create channel error."
          )}`
        );
      }
      continue;
    }

    usedChannelIds.add(existingChannel.id);

    const payload: UpdateGuildChannelPayload = {};
    if (existingChannel.name !== expectedChannelName) {
      payload.name = expectedChannelName;
    }
    if (String(existingChannel.topic ?? "") !== expectedTopic) {
      payload.topic = expectedTopic;
    }
    if (String(existingChannel.parent_id ?? "") !== expectedParentId) {
      payload.parent_id = expectedParentId;
    }
    if (
      !areOverwritesEqual(existingChannel.permission_overwrites, expectedOverwrites)
    ) {
      payload.permission_overwrites = expectedOverwrites;
    }

    if (Object.keys(payload).length === 0) {
      continue;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(
        existingChannel.id,
        payload
      );
      const channelIndex = mutableChannels.findIndex(
        (item) => item.id === existingChannel.id
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
    } catch (error) {
      result.errors.push(
        `Failed to update channel "${existingChannel.name}" for course "${course.title}": ${toErrorMessage(
          error,
          "Unknown update channel error."
        )}`
      );
    }
  }

  const ensureFixedChannel = async ({
    name,
    oldName,
    channelType,
    parentId,
    permissionOverwrites,
  }: {
    name: string;
    oldName?: string;
    channelType: number;
    parentId: string | null;
    permissionOverwrites: DiscordPermissionOverwrite[];
  }) => {
    let existing = findChannelByNameAndType(mutableChannels, name, channelType);
    if (!existing && oldName) {
      existing = findChannelByNameAndType(mutableChannels, oldName, channelType);
    }

    if (!existing) {
      try {
        const createPayload: CreateGuildChannelPayload = {
          name,
          type: channelType,
          permission_overwrites: permissionOverwrites,
        };
        if (parentId) {
          createPayload.parent_id = parentId;
        }
        const createdChannel = await apiClient.createGuildChannel(discordGuildId, {
          ...createPayload,
        });
        mutableChannels.push(createdChannel);
        result.createdChannelCount += 1;
        return createdChannel;
      } catch (error) {
        result.errors.push(
          `Failed to create channel "${name}": ${toErrorMessage(
            error,
            "Unknown create channel error."
          )}`
        );
        return null;
      }
    }

    const payload: UpdateGuildChannelPayload = {};
    if (existing.name !== name) {
      payload.name = name;
    }
    if (String(existing.parent_id ?? "") !== String(parentId ?? "")) {
      payload.parent_id = parentId;
    }
    if (
      !areOverwritesEqual(existing.permission_overwrites, permissionOverwrites)
    ) {
      payload.permission_overwrites = permissionOverwrites;
    }

    if (Object.keys(payload).length === 0) {
      return existing;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(existing.id, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === existing.id
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
      return updatedChannel;
    } catch (error) {
      result.errors.push(
        `Failed to update channel "${existing.name}": ${toErrorMessage(
          error,
          "Unknown update channel error."
        )}`
      );
      return existing;
    }
  };

  const infoChannel = await ensureFixedChannel({
    name: infoChannelName,
    channelType: discordTextChannelType,
    parentId: null,
    permissionOverwrites: buildInfoPermissionOverwrites(
      discordGuildId,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });

  const readmeChannel = await ensureFixedChannel({
    name: readmeChannelName,
    oldName: "notice",
    channelType: discordTextChannelType,
    parentId: null,
    permissionOverwrites: buildReadmePermissionOverwrites(
      discordGuildId,
      executiveRole.id,
      juniorExecutiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });

  const tasksChannel = await ensureFixedChannel({
    name: tasksChannelName,
    channelType: discordTextChannelType,
    parentId: null,
    permissionOverwrites: buildTasksPermissionOverwrites(
      discordGuildId,
      executiveRole.id,
      juniorExecutiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });

  const commitsChannel = await ensureFixedChannel({
    name: commitsChannelName,
    channelType: discordTextChannelType,
    parentId: null,
    permissionOverwrites: buildCommitsPermissionOverwrites(
      discordGuildId,
      executiveRole.id,
      juniorExecutiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });

  const websiteVoiceChannel = await ensureFixedChannel({
    name: websiteVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: null,
    permissionOverwrites: buildWebsiteVoicePermissionOverwrites(
      discordGuildId,
      botUser.id
    ),
  });

  const ensureFundraiserVoiceChannel = async () => {
    const excludedChannelIds = new Set<string>();
    if (websiteVoiceChannel) {
      excludedChannelIds.add(websiteVoiceChannel.id);
    }

    const existing = findFundraiserVoiceChannel(
      mutableChannels,
      fundraiserVoiceChannelName,
      excludedChannelIds
    );

    if (!fundraiserVoiceChannelName && !existing) {
      result.errors.push(
        "Fundraiser voice channel sync skipped: unable to fetch fundraiser total."
      );
      return null;
    }

    const targetName = fundraiserVoiceChannelName ?? existing?.name ?? null;
    if (!targetName) {
      return null;
    }

    const expectedOverwrites = buildWebsiteVoicePermissionOverwrites(
      discordGuildId,
      botUser.id
    );

    if (!existing) {
      try {
        const createdChannel = await apiClient.createGuildChannel(discordGuildId, {
          name: targetName,
          type: discordVoiceChannelType,
          permission_overwrites: expectedOverwrites,
        });
        mutableChannels.push(createdChannel);
        result.createdChannelCount += 1;
        return createdChannel;
      } catch (error) {
        result.errors.push(
          `Failed to create fundraiser voice channel "${targetName}": ${toErrorMessage(
            error,
            "Unknown create channel error."
          )}`
        );
        return null;
      }
    }

    const payload: UpdateGuildChannelPayload = {};
    if (existing.name !== targetName) {
      payload.name = targetName;
    }
    if (String(existing.parent_id ?? "") !== "") {
      payload.parent_id = null;
    }
    if (!areOverwritesEqual(existing.permission_overwrites, expectedOverwrites)) {
      payload.permission_overwrites = expectedOverwrites;
    }

    if (Object.keys(payload).length === 0) {
      return existing;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(existing.id, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === existing.id
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
      return updatedChannel;
    } catch (error) {
      result.errors.push(
        `Failed to update fundraiser voice channel "${existing.name}": ${toErrorMessage(
          error,
          "Unknown update channel error."
        )}`
      );
      return existing;
    }
  };

  const fundraiserVoiceChannel = await ensureFundraiserVoiceChannel();

  const everyoneChatChannel = await ensureFixedChannel({
    name: everyoneChatChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildEveryoneChatPermissionOverwrites(
      discordGuildId,
      studentRole.id,
      executiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });





  const foundersOnlyChannel = await ensureFixedChannel({
    name: foundersOnlyChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildFoundersPermissionOverwrites(
      discordGuildId,
      founderRole.id,
      botUser.id,
      cooRole.id,
      ceoRole.id
    ),
  });

  // Ping the COO in the founders channel whenever a member joins or leaves the
  // server. There is no realtime gateway, so we diff the current website-linked
  // membership against the snapshot persisted from the previous sync run.
  if (foundersOnlyChannel) {
    try {
      const discordUsernameByMemberId = new Map<string, string>();
      for (const member of humanMembers) {
        const memberId = member.user?.id;
        if (memberId && member.user?.username) {
          discordUsernameByMemberId.set(memberId, member.user.username);
        }
      }

      // A member who left is no longer in `humanMembers`, so their name cannot
      // come from `websiteUserByDiscordMemberId` (guild members only) — fall back
      // to the full website user table, which is keyed the same way.
      const websiteDisplayName = (memberId: string) => {
        const websiteUser =
          websiteUserByDiscordMemberId.get(memberId) ??
          websiteUserByDiscordUserId.get(memberId);
        return websiteUser?.full_name?.trim() || websiteUser?.email?.trim() || "";
      };

      const buildMemberLabel = (
        memberId: string,
        previousEntry?: DiscordMemberSnapshotEntry
      ) =>
        formatMemberLabel({
          memberId,
          username:
            discordUsernameByMemberId.get(memberId) || previousEntry?.username || "",
          // Last resort is the name recorded when they were last seen: someone who
          // left because their website account was deleted has no row to read.
          name: websiteDisplayName(memberId) || previousEntry?.name || "",
        });

      const currentSnapshot: DiscordMemberSnapshot = {};
      for (const memberId of websiteMemberIds) {
        currentSnapshot[memberId] = {
          username: discordUsernameByMemberId.get(memberId) ?? "",
          name: websiteDisplayName(memberId),
        };
      }

      const { data: settingsRow, error: snapshotReadError } = await adminClient
        .from("site_settings")
        .select("discord_member_snapshot")
        .eq("id", true)
        .single();

      if (snapshotReadError) {
        result.errors.push(
          `Failed to read Discord member snapshot (is the migration applied?): ${snapshotReadError.message}`
        );
      } else {
        const previousSnapshot = parseMemberSnapshot(
          settingsRow?.discord_member_snapshot
        );

        // Skip notifications on the very first run (no baseline yet) to avoid a flood.
        if (previousSnapshot) {
          const previousIds = new Set(Object.keys(previousSnapshot));
          const currentIds = new Set(Object.keys(currentSnapshot));

          const joinedIds = [...currentIds].filter((id) => !previousIds.has(id));
          const leftIds = [...previousIds].filter((id) => !currentIds.has(id));

          if (joinedIds.length > 0 || leftIds.length > 0) {
            const lines = [`<@&${cooRole.id}>`];
            for (const id of joinedIds) {
              lines.push(`📥 **Member joined:** ${buildMemberLabel(id)}`);
            }
            for (const id of leftIds) {
              lines.push(`📤 **Member left:** ${buildMemberLabel(id, previousSnapshot[id])}`);
            }

            // Chunk into messages under Discord's 2000 character limit.
            const messageCharLimit = 1900;
            let buffer = "";
            const flush = async () => {
              if (!buffer) {
                return;
              }
              await apiClient.createChannelMessage(foundersOnlyChannel.id, buffer);
              buffer = "";
            };
            try {
              for (const line of lines) {
                if (buffer && `${buffer}\n${line}`.length > messageCharLimit) {
                  await flush();
                }
                buffer = buffer ? `${buffer}\n${line}` : line;
              }
              await flush();
            } catch (error) {
              result.errors.push(
                `Failed to post Discord membership change notice: ${toErrorMessage(error, "Unknown error")}`
              );
            }
          }
        }

        const { error: snapshotWriteError } = await adminClient
          .from("site_settings")
          .update({ discord_member_snapshot: currentSnapshot })
          .eq("id", true);
        if (snapshotWriteError) {
          result.errors.push(
            `Failed to persist Discord member snapshot: ${snapshotWriteError.message}`
          );
        }
      }
    } catch (error) {
      result.errors.push(
        `Failed to process Discord membership change notifications: ${toErrorMessage(error, "Unknown error")}`
      );
    }
  }

  const executivesOnlyChannel = await ensureFixedChannel({
    name: executivesOnlyChannelName,
    oldName: "tutor-only",
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      executiveRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id, juniorExecutiveRole.id]
    ),
  });

  const socialMediaChannel = await ensureFixedChannel({
    name: socialMediaChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      socialMediaRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const scienceTutorsChannel = await ensureFixedChannel({
    name: scienceTutorsChannelName,
    oldName: "science-tutor",
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      scienceTutorsRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const mathTutorsChannel = await ensureFixedChannel({
    name: mathTutorsChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      mathTutorsRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const nonprofitTeamChannel = await ensureFixedChannel({
    name: nonprofitTeamChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      nonprofitTeamRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const developmentTeamChannel = await ensureFixedChannel({
    name: developmentTeamChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      developmentTeamRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const everyoneVoiceChannel = await ensureFixedChannel({
    name: everyoneVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildEveryoneVoicePermissionOverwrites(
      discordGuildId,
      studentRole.id,
      executiveRole.id,
      juniorExecutiveRole.id,
      founderRole.id,
      botUser.id,
      ceoRole.id,
      cooRole.id,
      chiefExecutiveRole.id
    ),
  });

  const executivesVoiceChannel = await ensureFixedChannel({
    name: executivesVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      executiveRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id, juniorExecutiveRole.id]
    ),
  });

  const socialMediaVoiceChannel = await ensureFixedChannel({
    name: socialMediaVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      socialMediaRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const scienceTutorsVoiceChannel = await ensureFixedChannel({
    name: scienceTutorsVoiceChannelName,
    oldName: "Science Tutor",
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      scienceTutorsRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const mathTutorsVoiceChannel = await ensureFixedChannel({
    name: mathTutorsVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      mathTutorsRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const nonprofitTeamVoiceChannel = await ensureFixedChannel({
    name: nonprofitTeamVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      nonprofitTeamRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const developmentTeamVoiceChannel = await ensureFixedChannel({
    name: developmentTeamVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      developmentTeamRole.id,
      botUser.id,
      [founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]
    ),
  });

  const enforceTextPosition = async (
    channelId: string,
    label: string,
    position: number
  ) => {
    const existing = mutableChannels.find((channel) => channel.id === channelId);
    if (!existing) {
      return;
    }

    const payload: UpdateGuildChannelPayload = {};
    if (String(existing.parent_id ?? "") !== textCategory.id) {
      payload.parent_id = textCategory.id;
    }
    if (typeof existing.position !== "number" || existing.position !== position) {
      payload.position = position;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(channelId, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === channelId
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
    } catch (error) {
      result.errors.push(
        `Failed to reorder channel "${label}" to position ${position}: ${toErrorMessage(
          error,
          "Unknown reorder channel error."
        )}`
      );
    }
  };

  let nextTextPosition = 0;
  if (everyoneChatChannel) {
    await enforceTextPosition(
      everyoneChatChannel.id,
      everyoneChatChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (foundersOnlyChannel) {
    await enforceTextPosition(
      foundersOnlyChannel.id,
      foundersOnlyChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (executivesOnlyChannel) {
    await enforceTextPosition(
      executivesOnlyChannel.id,
      executivesOnlyChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (socialMediaChannel) {
    await enforceTextPosition(
      socialMediaChannel.id,
      socialMediaChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (scienceTutorsChannel) {
    await enforceTextPosition(
      scienceTutorsChannel.id,
      scienceTutorsChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (mathTutorsChannel) {
    await enforceTextPosition(
      mathTutorsChannel.id,
      mathTutorsChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (nonprofitTeamChannel) {
    await enforceTextPosition(
      nonprofitTeamChannel.id,
      nonprofitTeamChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (developmentTeamChannel) {
    await enforceTextPosition(
      developmentTeamChannel.id,
      developmentTeamChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }

  const enforceVoicePosition = async (
    channelId: string,
    label: string,
    position: number
  ) => {
    const existing = mutableChannels.find((channel) => channel.id === channelId);
    if (!existing) {
      return;
    }

    const payload: UpdateGuildChannelPayload = {};
    if (String(existing.parent_id ?? "") !== voiceCategory.id) {
      payload.parent_id = voiceCategory.id;
    }
    if (typeof existing.position !== "number" || existing.position !== position) {
      payload.position = position;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(channelId, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === channelId
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
    } catch (error) {
      result.errors.push(
        `Failed to reorder channel "${label}" to position ${position}: ${toErrorMessage(
          error,
          "Unknown reorder channel error."
        )}`
      );
    }
  };

  let nextVoicePosition = 0;
  if (everyoneVoiceChannel) {
    await enforceVoicePosition(everyoneVoiceChannel.id, everyoneVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (executivesVoiceChannel) {
    await enforceVoicePosition(executivesVoiceChannel.id, executivesVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (socialMediaVoiceChannel) {
    await enforceVoicePosition(socialMediaVoiceChannel.id, socialMediaVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (scienceTutorsVoiceChannel) {
    await enforceVoicePosition(scienceTutorsVoiceChannel.id, scienceTutorsVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (mathTutorsVoiceChannel) {
    await enforceVoicePosition(mathTutorsVoiceChannel.id, mathTutorsVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (nonprofitTeamVoiceChannel) {
    await enforceVoicePosition(nonprofitTeamVoiceChannel.id, nonprofitTeamVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (developmentTeamVoiceChannel) {
    await enforceVoicePosition(developmentTeamVoiceChannel.id, developmentTeamVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }

  const enforceTopLevelPosition = async (
    channelId: string,
    label: string,
    position: number
  ) => {
    const existing = mutableChannels.find((channel) => channel.id === channelId);
    if (!existing) {
      return;
    }

    const payload: UpdateGuildChannelPayload = {};
    if (String(existing.parent_id ?? "") !== "") {
      payload.parent_id = null;
    }
    if (typeof existing.position !== "number" || existing.position !== position) {
      payload.position = position;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(channelId, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === channelId
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
    } catch (error) {
      result.errors.push(
        `Failed to reorder channel "${label}" to position ${position}: ${toErrorMessage(
          error,
          "Unknown reorder channel error."
        )}`
      );
    }
  };

  const liveCategory = findCategoryByName(mutableChannels, liveCategoryName);

  let nextTopLevelPosition = 0;
  if (infoChannel) {
    await enforceTopLevelPosition(
      infoChannel.id,
      infoChannelName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  if (readmeChannel) {
    await enforceTopLevelPosition(
      readmeChannel.id,
      readmeChannelName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  if (tasksChannel) {
    await enforceTopLevelPosition(
      tasksChannel.id,
      tasksChannelName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  if (commitsChannel) {
    await enforceTopLevelPosition(
      commitsChannel.id,
      commitsChannelName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  if (websiteVoiceChannel) {
    await enforceTopLevelPosition(
      websiteVoiceChannel.id,
      websiteVoiceChannelName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  if (fundraiserVoiceChannel) {
    await enforceTopLevelPosition(
      fundraiserVoiceChannel.id,
      fundraiserVoiceChannel.name,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  // The Live category (when present) sits directly above the Text category.
  if (liveCategory) {
    await enforceTopLevelPosition(
      liveCategory.id,
      liveCategoryName,
      nextTopLevelPosition
    );
    nextTopLevelPosition += 1;
  }
  await enforceTopLevelPosition(
    textCategory.id,
    textCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  await enforceTopLevelPosition(
    voiceCategory.id,
    voiceCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  await enforceTopLevelPosition(
    coursesCategory.id,
    coursesCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  nextTopLevelPosition += 1;


  const allowedTextChannelIds = new Set<string>(usedChannelIds);
  if (infoChannel) {
    allowedTextChannelIds.add(infoChannel.id);
  }
  if (readmeChannel) {
    allowedTextChannelIds.add(readmeChannel.id);
  }
  if (tasksChannel) {
    allowedTextChannelIds.add(tasksChannel.id);
  }
  if (commitsChannel) {
    allowedTextChannelIds.add(commitsChannel.id);
  }
  if (everyoneChatChannel) {
    allowedTextChannelIds.add(everyoneChatChannel.id);
  }




  if (foundersOnlyChannel) allowedTextChannelIds.add(foundersOnlyChannel.id);
  if (executivesOnlyChannel) allowedTextChannelIds.add(executivesOnlyChannel.id);
  if (socialMediaChannel) allowedTextChannelIds.add(socialMediaChannel.id);
  if (scienceTutorsChannel) allowedTextChannelIds.add(scienceTutorsChannel.id);
  if (mathTutorsChannel) allowedTextChannelIds.add(mathTutorsChannel.id);
  if (nonprofitTeamChannel) allowedTextChannelIds.add(nonprofitTeamChannel.id);
  if (developmentTeamChannel) allowedTextChannelIds.add(developmentTeamChannel.id);

  const allowedVoiceChannelIds = new Set<string>();
  if (websiteVoiceChannel) {
    allowedVoiceChannelIds.add(websiteVoiceChannel.id);
  }
  if (fundraiserVoiceChannel) {
    allowedVoiceChannelIds.add(fundraiserVoiceChannel.id);
  }
  if (everyoneVoiceChannel) allowedVoiceChannelIds.add(everyoneVoiceChannel.id);
  if (executivesVoiceChannel) allowedVoiceChannelIds.add(executivesVoiceChannel.id);
  if (socialMediaVoiceChannel) allowedVoiceChannelIds.add(socialMediaVoiceChannel.id);
  if (scienceTutorsVoiceChannel) allowedVoiceChannelIds.add(scienceTutorsVoiceChannel.id);
  if (mathTutorsVoiceChannel) allowedVoiceChannelIds.add(mathTutorsVoiceChannel.id);
  if (nonprofitTeamVoiceChannel) allowedVoiceChannelIds.add(nonprofitTeamVoiceChannel.id);
  if (developmentTeamVoiceChannel) allowedVoiceChannelIds.add(developmentTeamVoiceChannel.id);

  // Preserve temporary live-class voice channels (created by the class-reminders
  // cron). Their lifecycle is owned by that cron, so the sweep below must not
  // delete them. Any row without deleted_at is considered live.
  try {
    const { data: liveClassRows } = await adminClient
      .from("discord_live_class_channels")
      .select("discord_channel_id")
      .is("deleted_at", null);
    for (const row of liveClassRows ?? []) {
      const liveChannelId = String(row.discord_channel_id ?? "").trim();
      if (liveChannelId) {
        allowedVoiceChannelIds.add(liveChannelId);
      }
    }
  } catch (error) {
    result.errors.push(
      `Failed to load live class channels to preserve: ${toErrorMessage(error, "Unknown error.")}`
    );
  }

  const allowedCategoryIds = new Set<string>([
    textCategory.id,
    voiceCategory.id,
    coursesCategory.id,
  ]);
  // Keep the Live category around so the cron's ordering/state is stable; it is
  // only cleaned up by the cron, never by this sweep.
  if (liveCategory) {
    allowedCategoryIds.add(liveCategory.id);
  }

  for (const channel of [...mutableChannels]) {
    if (channel.type === discordCategoryChannelType) {
      continue;
    }

    const isAllowedTextChannel =
      channel.type === discordTextChannelType &&
      allowedTextChannelIds.has(channel.id);
    const isAllowedVoiceChannel =
      channel.type === discordVoiceChannelType &&
      allowedVoiceChannelIds.has(channel.id);

    if (isAllowedTextChannel || isAllowedVoiceChannel) {
      continue;
    }

    try {
      await apiClient.deleteChannel(channel.id);
      result.deletedChannelCount += 1;
      const channelIndex = mutableChannels.findIndex(
        (item) => item.id === channel.id
      );
      if (channelIndex >= 0) {
        mutableChannels.splice(channelIndex, 1);
      }
    } catch (error) {
      result.errors.push(
        `Failed to delete non-managed channel "${channel.name}": ${toErrorMessage(
          error,
          "Unknown delete channel error."
        )}`
      );
    }
  }

  for (const channel of [...mutableChannels]) {
    if (channel.type !== discordCategoryChannelType) {
      continue;
    }
    if (allowedCategoryIds.has(channel.id)) {
      continue;
    }

    const hasChildren = mutableChannels.some(
      (item) => String(item.parent_id ?? "") === channel.id
    );
    if (hasChildren) {
      continue;
    }

    try {
      await apiClient.deleteChannel(channel.id);
      result.deletedChannelCount += 1;
      const channelIndex = mutableChannels.findIndex(
        (item) => item.id === channel.id
      );
      if (channelIndex >= 0) {
        mutableChannels.splice(channelIndex, 1);
      }
    } catch (error) {
      result.errors.push(
        `Failed to delete non-managed category "${channel.name}": ${toErrorMessage(
          error,
          "Unknown delete category error."
        )}`
      );
    }
  }

  const courseStartMsMap = new Map<string, number>();
  for (const course of websiteCourses) {
    const roleId = courseRoleIdByCourseId.get(course.id);
    if (roleId) {
      courseStartMsMap.set(roleId, getCourseStartedAtMs(course));
    }
  }

  const rolesToSort = mutableRoles.filter((r) => r.id !== discordGuildId);
  const courseRoles: DiscordRole[] = [];
  const otherRoles: DiscordRole[] = [];
  
  for (const role of rolesToSort) {
    if (expectedCourseRoleIdSet.has(role.id)) {
      courseRoles.push(role);
    } else {
      otherRoles.push(role);
    }
  }

  courseRoles.sort((a, b) => {
    const aStart = courseStartMsMap.get(a.id) ?? Number.POSITIVE_INFINITY;
    const bStart = courseStartMsMap.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (aStart !== bStart) {
      return aStart - bStart;
    }
    return a.name.localeCompare(b.name);
  });

  otherRoles.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const sortedRoles = [...courseRoles, ...otherRoles];
  const rolePositionsPayload = sortedRoles.map((role, index) => ({
    id: role.id,
    position: index + 1,
  }));

  try {
    const updatedRoles = await apiClient.updateGuildRolePositions(discordGuildId, rolePositionsPayload);
    for (const updatedRole of updatedRoles) {
      const roleIndex = mutableRoles.findIndex((item) => item.id === updatedRole.id);
      if (roleIndex >= 0) {
        mutableRoles[roleIndex] = updatedRole;
      }
    }
  } catch (error) {
    result.errors.push(
      `Failed to update role positions: ${toErrorMessage(
        error,
        "Unknown update role positions error."
      )}`
    );
  }

  return result;
};
