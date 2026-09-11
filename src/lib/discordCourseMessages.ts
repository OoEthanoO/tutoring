const courseTopicPrefix = "yanlearn-course-id:";
const discordTextChannelType = 0;
const discordRoleOverwriteType = 0;
const manageChannelsPermission = BigInt(16);

export type DiscordCourseChannel = {
  id: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: Array<{
    id: string;
    type: number;
    allow?: string;
  }>;
};

export type DiscordCourseRole = {
  id: string;
  managed?: boolean;
};

export type DiscordCourseMessageTarget = {
  channelId: string;
  roleId: string;
};

const readCourseIdFromTopic = (topic?: string | null): string => {
  const value = String(topic ?? "").trim();
  if (!value.startsWith(courseTopicPrefix)) {
    return "";
  }
  const [courseId] = value.slice(courseTopicPrefix.length).trim().split("|");
  return courseId?.trim() ?? "";
};

const grantsManageChannels = (allow?: string): boolean => {
  try {
    return (BigInt(allow ?? "0") & manageChannelsPermission) !== BigInt(0);
  } catch {
    return false;
  }
};

/**
 * Finds the text channel created for a course and the course-specific role in
 * its overwrites. discordSync grants Manage Channels only to that course role,
 * which distinguishes it from the founder and executive access roles.
 */
export const findDiscordCourseMessageTarget = ({
  courseId,
  guildId,
  channels,
  roles,
}: {
  courseId: string;
  guildId: string;
  channels: DiscordCourseChannel[];
  roles: DiscordCourseRole[];
}): DiscordCourseMessageTarget | null => {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const candidates = channels
    .filter(
      (channel) =>
        channel.type === discordTextChannelType &&
        readCourseIdFromTopic(channel.topic) === courseId
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const channel of candidates) {
    const courseRoleId = (channel.permission_overwrites ?? [])
      .filter((overwrite) => {
        if (
          overwrite.type !== discordRoleOverwriteType ||
          overwrite.id === guildId ||
          !grantsManageChannels(overwrite.allow)
        ) {
          return false;
        }
        const role = roleById.get(overwrite.id);
        return Boolean(role && !role.managed);
      })
      .map((overwrite) => overwrite.id)
      .sort((left, right) => left.localeCompare(right))[0];

    if (courseRoleId) {
      return { channelId: channel.id, roleId: courseRoleId };
    }
  }

  return null;
};

const escapeDiscordMarkdown = (value: string): string =>
  value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");

export const buildRecordingReadyDiscordMessage = ({
  roleId,
  classTitle,
  siteUrl,
}: {
  roleId: string;
  classTitle: string;
  siteUrl: string;
}): string => {
  const title = escapeDiscordMarkdown(classTitle.trim() || "Your class");
  return [
    `<@&${roleId}>`,
    `The recording for **${title}** is fully uploaded and ready to view.`,
    `Open **My classes** in YanLearn and select **Watch** under **Class recordings**: <${siteUrl}/?menu=my_classes>`,
  ].join("\n");
};
