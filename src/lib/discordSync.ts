import type { SupabaseClient } from "@supabase/supabase-js";
import { founderEmail, resolveUserRole } from "@/lib/roles";

const discordApiBase = "https://discord.com/api/v10";
const courseTopicPrefix = "yanlearn-course-id:";
const defaultCoursesCategoryName = "Courses";
const defaultArchiveCategoryName = "Archived";
const defaultCommunityCategoryName = "Community";
const defaultInfoChannelName = "info";
const defaultWebsiteVoiceChannelName = "learn.ethanyanxu.com";
const defaultEveryoneChatChannelName = "everyone";
const defaultTutorOnlyChannelName = "tutor-only";
const discordTextChannelType = 0;
const discordVoiceChannelType = 2;
const discordCategoryChannelType = 4;
const channelNameLimit = 100;
const roleNameLimit = 100;

const viewChannelPermission = 1024;
const sendMessagesPermission = 2048;
const readMessageHistoryPermission = 65536;
const connectPermission = 1048576;

type WebsiteUserRow = {
  id: string;
  email: string | null;
  role: string | null;
  discord_user_id: string | null;
};

type CourseRow = {
  id: string;
  title: string;
  is_completed: boolean;
  created_by: string | null;
  course_classes?: CourseClassRow[] | null;
};

type CourseEnrollmentRow = {
  course_id: string;
  student_id: string;
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
  roles?: string[];
};

type DiscordRole = {
  id: string;
  name: string;
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
  archivedChannelCount: number;
  deletedChannelCount: number;
  deletedCourseRoleCount: number;
  errors: string[];
};

type DiscordSyncParams = {
  adminClient: SupabaseClient;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeChannelName = (title: string, fallbackCourseId: string): string => {
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

const normalizeRoleName = (title: string, fallbackCourseId: string): string => {
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

const buildUniqueCourseRoleName = (
  baseName: string,
  courseId: string,
  roles: DiscordRole[]
) => {
  const normalizedBase = baseName.trim().slice(0, roleNameLimit) || "Course";
  if (!roleNameExists(roles, normalizedBase)) {
    return normalizedBase;
  }

  const suffixSeed = getCourseRoleSuffix(courseId);
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const suffix = attempt === 1 ? ` (${suffixSeed})` : ` (${suffixSeed}-${attempt})`;
    const maxBaseLength = Math.max(1, roleNameLimit - suffix.length);
    const candidate = `${normalizedBase.slice(0, maxBaseLength)}${suffix}`;
    if (!roleNameExists(roles, candidate)) {
      return candidate;
    }
  }

  return `${normalizedBase.slice(0, roleNameLimit - 4)}-alt`;
};

const getCourseTopicMarker = (courseId: string) => `${courseTopicPrefix}${courseId}`;

const readCourseIdFromTopic = (topic?: string | null) => {
  const value = String(topic ?? "").trim();
  if (!value.startsWith(courseTopicPrefix)) {
    return "";
  }
  return value.slice(courseTopicPrefix.length).trim();
};

const isCourseCompleted = (course: CourseRow, nowMs: number) => {
  if (course.is_completed) {
    return true;
  }

  const classRows = Array.isArray(course.course_classes)
    ? course.course_classes
    : [];
  if (classRows.length === 0) {
    return false;
  }

  let latestClassEndMs = Number.NEGATIVE_INFINITY;
  for (const classRow of classRows) {
    const startsAtMs = new Date(String(classRow.starts_at)).getTime();
    if (Number.isNaN(startsAtMs)) {
      continue;
    }

    const durationHours =
      typeof classRow.duration_hours === "number"
        ? classRow.duration_hours
        : Number.parseFloat(String(classRow.duration_hours));
    const durationMs =
      Number.isFinite(durationHours) && durationHours > 0
        ? durationHours * 60 * 60 * 1000
        : 60 * 60 * 1000;

    latestClassEndMs = Math.max(latestClassEndMs, startsAtMs + durationMs);
  }

  if (!Number.isFinite(latestClassEndMs)) {
    return false;
  }

  return latestClassEndMs <= nowMs;
};

const buildCoursePermissionOverwrites = (
  guildId: string,
  courseRoleId: string,
  botUserId: string,
  archived: boolean
): DiscordPermissionOverwrite[] => {
  const readOnlyAllow = String(viewChannelPermission | readMessageHistoryPermission);
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
      id: courseRoleId,
      type: 0,
      allow: archived ? readOnlyAllow : activeAllow,
      deny: archived ? String(sendMessagesPermission) : "0",
    },
    {
      // Keep bot access so future sync runs can still patch the channel.
      id: botUserId,
      type: 1,
      allow: activeAllow,
      deny: "0",
    },
  ];
};

const buildInfoPermissionOverwrites = (
  guildId: string,
  founderRoleId: string,
  botUserId: string
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
      id: botUserId,
      type: 1,
      allow: founderAllow,
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
    allow: String(viewChannelPermission),
    deny: String(connectPermission),
  },
];

const buildEveryoneChatPermissionOverwrites = (
  guildId: string,
  studentRoleId: string,
  tutorRoleId: string,
  founderRoleId: string,
  botUserId: string
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
      id: tutorRoleId,
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
      id: botUserId,
      type: 1,
      allow: activeAllow,
      deny: "0",
    },
  ];
};

const buildTutorOnlyPermissionOverwrites = (
  guildId: string,
  tutorRoleId: string,
  botUserId: string
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
      id: tutorRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: activeAllow,
      deny: "0",
    },
  ];
};

const sortOverwriteKeys = (overwrites: DiscordPermissionOverwrite[] | undefined) =>
  (overwrites ?? [])
    .map(
      (item) =>
        `${item.id}:${String(item.type)}:${String(item.allow)}:${String(item.deny)}`
    )
    .sort();

const areOverwritesEqual = (
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

  listGuildChannels(guildId: string) {
    return this.request<DiscordGuildChannel[]>({
      method: "GET",
      path: `/guilds/${guildId}/channels`,
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

const findCourseChannel = (
  channels: DiscordGuildChannel[],
  courseId: string,
  expectedName: string,
  usedChannelIds: Set<string>
) => {
  const marker = getCourseTopicMarker(courseId);

  const byTopic =
    channels.find(
      (channel) =>
        channel.type === discordTextChannelType &&
        String(channel.topic ?? "") === marker &&
        !usedChannelIds.has(channel.id)
    ) ?? null;
  if (byTopic) {
    return byTopic;
  }

  const byNameCandidates = channels
    .filter(
      (channel) =>
        channel.type === discordTextChannelType &&
        channel.name === expectedName &&
        !usedChannelIds.has(channel.id)
    )
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
  archivedChannelCount: 0,
  deletedChannelCount: 0,
  deletedCourseRoleCount: 0,
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
  const archiveCategoryName =
    String(process.env.DISCORD_ARCHIVE_CATEGORY_NAME ?? "").trim() ||
    defaultArchiveCategoryName;
  const communityCategoryName =
    String(process.env.DISCORD_COMMUNITY_CATEGORY_NAME ?? "").trim() ||
    defaultCommunityCategoryName;
  const infoChannelName =
    String(process.env.DISCORD_INFO_CHANNEL_NAME ?? "").trim() ||
    defaultInfoChannelName;
  const websiteVoiceChannelName =
    String(process.env.DISCORD_URL_VOICE_CHANNEL_NAME ?? "").trim() ||
    defaultWebsiteVoiceChannelName;
  const everyoneChatChannelName =
    String(process.env.DISCORD_EVERYONE_CHANNEL_NAME ?? "").trim() ||
    defaultEveryoneChatChannelName;
  const tutorOnlyChannelName =
    String(process.env.DISCORD_TUTOR_ONLY_CHANNEL_NAME ?? "").trim() ||
    defaultTutorOnlyChannelName;
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

  const [{ data: users, error: usersError }, { data: courses, error: coursesError }, { data: enrollments, error: enrollmentsError }] =
    await Promise.all([
      adminClient
        .from("app_users")
        .select("id, email, role, discord_user_id"),
      adminClient
        .from("courses")
        .select("id, title, is_completed, created_by, course_classes(starts_at, duration_hours)"),
      adminClient
        .from("course_enrollments")
        .select("course_id, student_id"),
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

  const websiteUsers = (users ?? []) as WebsiteUserRow[];
  const websiteCourses = (courses ?? []) as CourseRow[];
  const websiteEnrollments = (enrollments ?? []) as CourseEnrollmentRow[];
  const nowMs = Date.now();
  const shouldArchiveByCourseId = new Map<string, boolean>();
  for (const course of websiteCourses) {
    shouldArchiveByCourseId.set(course.id, isCourseCompleted(course, nowMs));
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

  const studentRole = await ensureRole("Student", false);
  const tutorRole = await ensureRole("Tutor", false);
  const founderRole = await ensureRole("Founder", false);
  const baseRoleIds = new Set([studentRole.id, tutorRole.id, founderRole.id]);
  const founderDiscordUserId =
    websiteUsers.find(
      (user) =>
        String(user.email ?? "").trim().toLowerCase() ===
        founderEmail.toLowerCase()
    )?.discord_user_id ?? null;

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

    const websiteRole = resolveUserRole(websiteUser.email, websiteUser.role);
    const shouldBeFounder =
      Boolean(founderDiscordUserId) && memberId === founderDiscordUserId;
    const shouldBeTutor = websiteRole === "tutor";

    if (shouldBeFounder) {
      if (!roleSet.has(founderRole.id)) {
        await addRoleToMember(
          memberId,
          founderRole.id,
          roleSet,
          "baseRoleAddedCount"
        );
      }

      if (roleSet.has(tutorRole.id)) {
        await addRoleToMember(
          memberId,
          tutorRole.id,
          roleSet,
          "baseRoleRemovedCount",
          true
        );
      }

      if (roleSet.has(studentRole.id)) {
        await addRoleToMember(
          memberId,
          studentRole.id,
          roleSet,
          "baseRoleRemovedCount",
          true
        );
      }
      continue;
    }

    if (shouldBeTutor) {
      if (!roleSet.has(tutorRole.id)) {
        await addRoleToMember(
          memberId,
          tutorRole.id,
          roleSet,
          "baseRoleAddedCount"
        );
      }

      if (roleSet.has(studentRole.id)) {
        await addRoleToMember(
          memberId,
          studentRole.id,
          roleSet,
          "baseRoleRemovedCount",
          true
        );
      }
      if (roleSet.has(founderRole.id)) {
        await addRoleToMember(
          memberId,
          founderRole.id,
          roleSet,
          "baseRoleRemovedCount",
          true
        );
      }
      continue;
    }

    if (!roleSet.has(studentRole.id)) {
      await addRoleToMember(
        memberId,
        studentRole.id,
        roleSet,
        "baseRoleAddedCount"
      );
    }

    if (roleSet.has(tutorRole.id)) {
      await addRoleToMember(
        memberId,
        tutorRole.id,
        roleSet,
        "baseRoleRemovedCount",
        true
      );
    }

    if (roleSet.has(founderRole.id)) {
      await addRoleToMember(
        memberId,
        founderRole.id,
        roleSet,
        "baseRoleRemovedCount",
        true
      );
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

  const courseRoleIdFromManagedChannelByCourseId = new Map<string, string>();
  const courseIdsWithManagedChannels = new Set<string>();
  for (const channel of mutableChannels) {
    if (channel.type !== discordTextChannelType) {
      continue;
    }

    const courseId = readCourseIdFromTopic(channel.topic);
    if (!courseId) {
      continue;
    }

    courseIdsWithManagedChannels.add(courseId);
    if (courseRoleIdFromManagedChannelByCourseId.has(courseId)) {
      continue;
    }

    const candidateRoleId = getRoleIdsFromOverwrites(channel, discordGuildId)
      .filter((roleId) => {
        if (baseRoleIds.has(roleId)) {
          return false;
        }
        const role = mutableRoles.find((item) => item.id === roleId);
        return Boolean(role && !role.managed);
      })
      .sort((left, right) => left.localeCompare(right))[0];

    if (candidateRoleId) {
      courseRoleIdFromManagedChannelByCourseId.set(courseId, candidateRoleId);
    }
  }

  const websiteCourseById = new Map(
    websiteCourses.map((course) => [course.id, course] as const)
  );
  const courseRoleIdByCourseId = new Map<string, string>();
  for (const course of websiteCourses) {
    const shouldArchive = shouldArchiveByCourseId.get(course.id) === true;
    const hasManagedChannel = courseIdsWithManagedChannels.has(course.id);

    // Completed courses without a managed channel should not create roles/channels.
    if (shouldArchive && !hasManagedChannel) {
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
    const tutorId = String(course.created_by ?? "").trim();
    if (tutorId) {
      const discordUserId = discordUserIdByWebsiteUserId.get(tutorId);
      if (discordUserId) {
        expectedDiscordMemberIds.add(discordUserId);
      }
    }

    for (const studentId of enrollmentsByCourseId.get(course.id) ?? []) {
      const discordUserId = discordUserIdByWebsiteUserId.get(studentId);
      if (discordUserId) {
        expectedDiscordMemberIds.add(discordUserId);
      }
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

  const activeCourseIdSet = new Set(websiteCourses.map((course) => course.id));
  const expectedCourseRoleIdSet = new Set(courseRoleIdByCourseId.values());
  const staleCourseRoleIdCandidates = new Set<string>();

  for (const channel of [...mutableChannels]) {
    if (channel.type !== discordTextChannelType) {
      continue;
    }

    const courseId = readCourseIdFromTopic(channel.topic);
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
    if (baseRoleIds.has(role.id) || expectedCourseRoleIdSet.has(role.id)) {
      continue;
    }
    if (protectedRoleNames.has(role.name.toLowerCase())) {
      continue;
    }
    staleCourseRoleIdCandidates.add(role.id);
  }

  for (const roleId of staleCourseRoleIdCandidates) {
    if (baseRoleIds.has(roleId) || expectedCourseRoleIdSet.has(roleId)) {
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
      if (!readCourseIdFromTopic(channel.topic)) {
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

  const communityCategory = await ensureCategory(communityCategoryName);
  const coursesCategory = await ensureCategory(coursesCategoryName);
  const archiveCategory = await ensureCategory(archiveCategoryName);
  const usedChannelIds = new Set<string>();

  for (const course of websiteCourses) {
    const courseRoleId = courseRoleIdByCourseId.get(course.id);
    if (!courseRoleId) {
      continue;
    }

    const expectedChannelName = normalizeChannelName(course.title, course.id);
    const expectedTopic = getCourseTopicMarker(course.id);
    const shouldArchive = shouldArchiveByCourseId.get(course.id) === true;
    const expectedParentId = shouldArchive ? archiveCategory.id : coursesCategory.id;
    const expectedOverwrites = buildCoursePermissionOverwrites(
      discordGuildId,
      courseRoleId,
      botUser.id,
      shouldArchive
    );

    const existingChannel = findCourseChannel(
      mutableChannels,
      course.id,
      expectedChannelName,
      usedChannelIds
    );

    if (!existingChannel && shouldArchive) {
      continue;
    }

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
      if (shouldArchive) {
        result.archivedChannelCount += 1;
      } else {
        result.updatedChannelCount += 1;
      }
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
    channelType,
    parentId,
    permissionOverwrites,
  }: {
    name: string;
    channelType: number;
    parentId: string | null;
    permissionOverwrites: DiscordPermissionOverwrite[];
  }) => {
    const existing = findChannelByNameAndType(mutableChannels, name, channelType);

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
      botUser.id
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

  const everyoneChatChannel = await ensureFixedChannel({
    name: everyoneChatChannelName,
    channelType: discordTextChannelType,
    parentId: communityCategory.id,
    permissionOverwrites: buildEveryoneChatPermissionOverwrites(
      discordGuildId,
      studentRole.id,
      tutorRole.id,
      founderRole.id,
      botUser.id
    ),
  });

  const tutorOnlyChannel = await ensureFixedChannel({
    name: tutorOnlyChannelName,
    channelType: discordTextChannelType,
    parentId: communityCategory.id,
    permissionOverwrites: buildTutorOnlyPermissionOverwrites(
      discordGuildId,
      tutorRole.id,
      botUser.id
    ),
  });

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
        `Failed to reorder channel "${label}": ${toErrorMessage(
          error,
          "Unknown reorder channel error."
        )}`
      );
    }
  };

  if (infoChannel) {
    await enforceTopLevelPosition(infoChannel.id, infoChannelName, 0);
  }
  if (websiteVoiceChannel) {
    await enforceTopLevelPosition(
      websiteVoiceChannel.id,
      websiteVoiceChannelName,
      1
    );
  }
  await enforceTopLevelPosition(communityCategory.id, communityCategoryName, 2);
  await enforceTopLevelPosition(coursesCategory.id, coursesCategoryName, 3);
  await enforceTopLevelPosition(archiveCategory.id, archiveCategoryName, 4);

  const allowedTextChannelIds = new Set<string>(usedChannelIds);
  if (infoChannel) {
    allowedTextChannelIds.add(infoChannel.id);
  }
  if (everyoneChatChannel) {
    allowedTextChannelIds.add(everyoneChatChannel.id);
  }
  if (tutorOnlyChannel) {
    allowedTextChannelIds.add(tutorOnlyChannel.id);
  }

  const allowedVoiceChannelIds = new Set<string>();
  if (websiteVoiceChannel) {
    allowedVoiceChannelIds.add(websiteVoiceChannel.id);
  }

  const allowedCategoryIds = new Set<string>([
    communityCategory.id,
    coursesCategory.id,
    archiveCategory.id,
  ]);

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

  return result;
};
