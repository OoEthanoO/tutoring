/**
 * Who can ping @everyone and @here: the founder trio (Founder, CEO, COO) and
 * nobody else.
 *
 * Two ways to ping everyone have to be closed for that to hold:
 *
 * - In Discord itself, through the "Mention @everyone, @here, and All Roles"
 *   permission. Everyone holds @everyone's permissions, so it has to come off
 *   that role and every other role but the trio's. The Discord sync applies
 *   planMentionEveryone() on each run.
 * - Through YanBot. Anything the bot posts with Discord's default mention
 *   parsing pings @everyone if the text contains it, and some of that text is
 *   typed by tutors (a course request title, say). Bot sends use
 *   withoutEveryoneMentions, or an explicit allowlist, instead.
 *
 * Pure and unit tested — the sync itself cannot be run without a guild.
 */

/** "Mention @everyone, @here, and All Roles". */
export const mentionEveryonePermission = BigInt(1) << BigInt(17);
/** Administrator implies every permission, this one included. */
const administratorPermission = BigInt(1) << BigInt(3);

/**
 * allowed_mentions for a bot message: user and role mentions written into the
 * text still ping, @everyone and @here never do.
 */
export const withoutEveryoneMentions = { parse: ["users", "roles"] as string[] };

const toBits = (permissions: string): bigint => {
  try {
    return BigInt(permissions);
  } catch {
    return BigInt(0);
  }
};

/** Does this bitfield let its holder ping everyone? */
export const grantsMentionEveryone = (permissions?: string | null): boolean => {
  const bits = toBits(String(permissions ?? "0"));
  return (bits & (mentionEveryonePermission | administratorPermission)) !== BigInt(0);
};

/** The same bitfield with only the mention-everyone bit changed. */
export const setMentionEveryone = (permissions: string, allowed: boolean): string => {
  const bits = toBits(permissions);
  return (allowed ? bits | mentionEveryonePermission : bits & ~mentionEveryonePermission).toString();
};

type PlannedRole = {
  id: string;
  name: string;
  managed?: boolean;
  permissions?: string;
};

export type MentionEveryonePlan = {
  /** Role permission changes to make, each touching only the one bit. */
  updates: { roleId: string; name: string; permissions: string }[];
  /**
   * True when @everyone still grants the permission and was left alone,
   * because it is where YanBot's own ability to ping roles comes from.
   */
  everyoneRoleKept: boolean;
  /** Roles outside the trio with Administrator, which pings everyone anyway. */
  administratorRoleNames: string[];
};

export const planMentionEveryone = ({
  roles,
  guildId,
  leaderRoleIds,
  botRoleIds,
}: {
  roles: PlannedRole[];
  /** The @everyone role shares the guild's id. */
  guildId: string;
  /** Founder, CEO and COO: the only roles that keep the permission. */
  leaderRoleIds: Set<string>;
  /** Roles held by YanBot's own member, which are never changed. */
  botRoleIds: Set<string>;
}): MentionEveryonePlan => {
  // The same permission lets YanBot ping roles that are not mentionable, which
  // is every course role, Executive and Pending. If the bot only has it through
  // @everyone, taking it off @everyone silences the bot's own pings — so in
  // that case @everyone keeps it and the caller reports why.
  const botHasItOwnRight = roles.some(
    (role) => role.id !== guildId && botRoleIds.has(role.id) && grantsMentionEveryone(role.permissions)
  );

  const plan: MentionEveryonePlan = { updates: [], everyoneRoleKept: false, administratorRoleNames: [] };

  for (const role of roles) {
    // Integration roles cannot be edited, and the bot's own are its lifeline.
    if (role.managed || botRoleIds.has(role.id)) {
      continue;
    }
    // Writing a bitfield computed from a missing one would wipe the role.
    if (typeof role.permissions !== "string") {
      continue;
    }

    const isEveryoneRole = role.id === guildId;
    const allowed = !isEveryoneRole && leaderRoleIds.has(role.id);

    if (isEveryoneRole && !botHasItOwnRight) {
      if (grantsMentionEveryone(role.permissions)) {
        plan.everyoneRoleKept = true;
      }
      continue;
    }

    if (!allowed && (toBits(role.permissions) & administratorPermission) !== BigInt(0)) {
      plan.administratorRoleNames.push(isEveryoneRole ? "@everyone" : role.name);
    }

    const next = setMentionEveryone(role.permissions, allowed);
    if (next !== toBits(role.permissions).toString()) {
      plan.updates.push({ roleId: role.id, name: isEveryoneRole ? "@everyone" : role.name, permissions: next });
    }
  }

  return plan;
};
