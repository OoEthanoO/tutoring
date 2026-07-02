import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runDiscordSync, type DiscordSyncResult } from "@/lib/discordSync";
import { runGithubSync, type GithubSyncResult } from "@/lib/githubSync";
import { fetchFundraisingRaisedAmount } from "@/lib/fundraising";
import {
  isFounder as isFounderRole,
  resolveRoleByEmail,
  resolveUserRole,
  type UserRole,
} from "@/lib/roles";
import { deleteZoomMeeting } from "@/lib/zoom";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const cronSecret = process.env.CRON_SECRET ?? "";
const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";
const discordApiBase = "https://discord.com/api/v10";
const courseTopicPrefix = "yanlearn-course-id:";
const discordTextChannelType = 0;
const discordVoiceChannelType = 2;
const discordCategoryChannelType = 4;
const defaultExecutivesChannelName = "executives";
const defaultTextCategoryName = "Text";
const defaultLiveCategoryName = "Live";
const torontoTimeZone = "America/Toronto";
const defaultZoomId = "822 9677 5321";
const defaultZoomPassword = "youth";
const viewChannelPermission = 1024;
const connectPermission = 1048576;
const speakPermission = 2097152;
const manageChannelsPermission = 16;
type ReminderType =
  | "twenty_four_hours"
  | "six_hours"
  | "one_hour"
  | "fifteen_minutes"
  | "ten_minutes"
  | "five_minutes";

type ReminderTarget = {
  type: ReminderType;
  minutesBeforeStart: number;
  label: string;
  lowerBoundDriftMinutes: number;
};

const reminderTargets: ReminderTarget[] = [
  {
    type: "twenty_four_hours",
    minutesBeforeStart: 24 * 60,
    label: "24 hours",
    lowerBoundDriftMinutes: 0,
  },
  {
    type: "six_hours",
    minutesBeforeStart: 6 * 60,
    label: "6 hours",
    lowerBoundDriftMinutes: 0,
  },
  {
    type: "one_hour",
    minutesBeforeStart: 60,
    label: "1 hour",
    lowerBoundDriftMinutes: 0,
  },
  {
    type: "fifteen_minutes",
    minutesBeforeStart: 15,
    label: "15 minutes",
    lowerBoundDriftMinutes: 0,
  },
  {
    type: "ten_minutes",
    minutesBeforeStart: 10,
    label: "10 minutes",
    lowerBoundDriftMinutes: 0,
  },
  {
    type: "five_minutes",
    minutesBeforeStart: 5,
    label: "5 minutes",
    lowerBoundDriftMinutes: 0,
  },
];

type CourseRow = {
  id: string;
  title: string;
  short_name?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  first_class_date?: string | null;
};

type ClassRow = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number | string;
  course_id: string;
  course: CourseRow | CourseRow[] | null;
};

type CandidateReminder = {
  reminderType: ReminderType;
  reminderLabel: string;
  classRow: ClassRow;
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
  parent_id?: string | null;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type DiscordRole = {
  id: string;
  name: string;
};

type DiscordCurrentUser = {
  id: string;
};

type DiscordCourseReminderTarget = {
  channelId: string;
  roleId: string;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeDiscordText = (value: string) => value.replaceAll("@", "@\u200b");

const formatOrdinalClass = (title: string) => {
  const match = title.match(/^Class\s+(\d+)$/i);
  if (!match) return title;
  const num = parseInt(match[1], 10);
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) return `${num}st class`;
  if (j === 2 && k !== 12) return `${num}nd class`;
  if (j === 3 && k !== 13) return `${num}rd class`;
  return `${num}th class`;
};

const readCourse = (value: ClassRow["course"]): CourseRow | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

/**
 * Determine if a course should use Discord live voice channels.
 * Criteria:
 * - First class date is on or after June 24, 2026
 */
const shouldUseDiscordVoiceSystem = (firstClassDate: Date | null): boolean => {
  const june24_2026 = new Date("2026-06-24T00:00:00Z");
  return firstClassDate !== null && firstClassDate >= june24_2026;
};

/**
 * Build a map of course IDs to their first class date
 */
const buildFirstClassDateMap = async (
  adminClient: SupabaseClient,
  courseIds: string[]
): Promise<Map<string, Date>> => {
  const map = new Map<string, Date>();
  
  if (courseIds.length === 0) {
    return map;
  }

  const { data: classes } = await adminClient
    .from("course_classes")
    .select("course_id, starts_at")
    .in("course_id", courseIds)
    .order("starts_at", { ascending: true });

  if (classes) {
    for (const cls of classes) {
      if (!map.has(cls.course_id)) {
        map.set(cls.course_id, new Date(cls.starts_at));
      }
    }
  }

  return map;
};

const floorToMinuteBoundary = (value: Date) => {
  const rounded = new Date(value.getTime());
  rounded.setSeconds(0, 0);
  return rounded;
};

const formatTorontoDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: torontoTimeZone,
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const readCourseIdFromTopic = (topic?: string | null) => {
  const value = String(topic ?? "").trim();
  if (!value.startsWith(courseTopicPrefix)) {
    return "";
  }
  const content = value.slice(courseTopicPrefix.length).trim();
  const [id] = content.split("|");
  return id ?? "";
};

const baseRoleNames = new Set([
  "Student",
  "Executive",
  "Junior Executive",
  "CEO",
  "COO",
  "Chief Executive",
  "Social Media",
  "Science Tutor",
  "Math Tutor",
  "Nonprofit Team",
  "Founder",
  "Strike",
]);

const getCourseRoleIdsFromOverwrites = (
  channel: DiscordGuildChannel,
  guildId: string,
  guildRoles: { id: string; name: string }[]
) => {
  const roleById = new Map(guildRoles.map((r) => [r.id, r]));
  return (channel.permission_overwrites ?? [])
    .filter((overwrite) => {
      if (overwrite.type !== 0 || overwrite.id === guildId) {
        return false;
      }
      const role = roleById.get(overwrite.id);
      if (!role) {
        return false;
      }
      return !baseRoleNames.has(role.name);
    })
    .map((overwrite) => overwrite.id)
    .sort((left, right) => left.localeCompare(right));
};

const buildDiscordCourseTargetMap = (
  channels: DiscordGuildChannel[],
  guildId: string,
  guildRoles: { id: string; name: string }[]
) => {
  const map = new Map<string, DiscordCourseReminderTarget>();

  for (const channel of channels) {
    if (channel.type !== discordTextChannelType) {
      continue;
    }

    const courseId = readCourseIdFromTopic(channel.topic);
    if (!courseId) {
      continue;
    }

    const roleId = getCourseRoleIdsFromOverwrites(channel, guildId, guildRoles)[0];
    if (!roleId) {
      continue;
    }

    const current = map.get(courseId);
    if (!current || channel.id.localeCompare(current.channelId) < 0) {
      map.set(courseId, { channelId: channel.id, roleId });
    }
  }

  return map;
};

const requestDiscord = async <T>({
  method,
  path,
  body,
}: {
  method: string;
  path: string;
  body?: unknown;
}) => {
  if (!discordBotToken) {
    throw new Error("Missing DISCORD_BOT_TOKEN.");
  }

  const url = `${discordApiBase}${path}`;
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bot ${discordBotToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const textPayload = await response.text().catch(() => "");
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
};

const listDiscordGuildChannels = async (guildId: string) =>
  requestDiscord<DiscordGuildChannel[]>({
    method: "GET",
    path: `/guilds/${guildId}/channels`,
  });

const listDiscordGuildRoles = async (guildId: string) =>
  requestDiscord<DiscordRole[]>({
    method: "GET",
    path: `/guilds/${guildId}/roles`,
  });

const sendDiscordCourseReminderMessage = async (
  channelId: string,
  roleId: string,
  content: string
) =>
  requestDiscord<void>({
    method: "POST",
    path: `/channels/${channelId}/messages`,
    body: {
      content,
      allowed_mentions: {
        parse: [],
        roles: [roleId],
        users: [],
      },
    },
  });

const sendDiscordUserMentionMessage = async (
  channelId: string,
  userId: string,
  content: string
) =>
  requestDiscord<void>({
    method: "POST",
    path: `/channels/${channelId}/messages`,
    body: {
      content,
      allowed_mentions: {
        parse: [],
        roles: [],
        users: [userId],
      },
    },
  });

const createDiscordGuildChannel = async (
  guildId: string,
  payload: Record<string, unknown>
) =>
  requestDiscord<DiscordGuildChannel>({
    method: "POST",
    path: `/guilds/${guildId}/channels`,
    body: payload,
  });

const updateDiscordChannel = async (
  channelId: string,
  payload: Record<string, unknown>
) =>
  requestDiscord<DiscordGuildChannel>({
    method: "PATCH",
    path: `/channels/${channelId}`,
    body: payload,
  });

const deleteDiscordChannel = async (channelId: string) =>
  requestDiscord<void>({
    method: "DELETE",
    path: `/channels/${channelId}`,
  });

const reorderDiscordChannels = async (
  guildId: string,
  positions: { id: string; position: number }[]
) =>
  requestDiscord<void>({
    method: "PATCH",
    path: `/guilds/${guildId}/channels`,
    body: positions,
  });

const getDiscordCurrentUser = async () =>
  requestDiscord<DiscordCurrentUser>({
    method: "GET",
    path: `/users/@me`,
  });

const getDiscordUserVoiceChannelId = async (
  guildId: string,
  userId: string
): Promise<string | null> => {
  try {
    const voiceState = await requestDiscord<{ channel_id?: string | null }>({
      method: "GET",
      path: `/guilds/${guildId}/voice-states/${userId}`,
    });
    return String(voiceState?.channel_id ?? "").trim() || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unknown voice state")) {
      return null;
    }
    throw error;
  }
};

const normalizeVoiceChannelName = (title: string, fallbackClassId: string) => {
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

const buildLiveVoicePermissionOverwrites = ({
  guildId,
  botUserId,
  ceoRoleId,
  cooRoleId,
  tutorDiscordUserId,
  studentDiscordUserIds,
}: {
  guildId: string;
  botUserId: string;
  ceoRoleId: string | null;
  cooRoleId: string | null;
  tutorDiscordUserId: string;
  studentDiscordUserIds: string[];
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

  if (ceoRoleId) {
    overwrites.push({ id: ceoRoleId, type: 0, allow: allowJoin, deny: "0" });
  }
  if (cooRoleId) {
    overwrites.push({ id: cooRoleId, type: 0, allow: allowJoin, deny: "0" });
  }

  for (const studentId of studentDiscordUserIds) {
    overwrites.push({
      id: studentId,
      type: 1,
      allow: allowJoin,
      deny: "0",
    });
  }

  return overwrites;
};

const sendEmail = async (to: string, subject: string, html: string) => {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to,
        subject,
        html,
      }),
    });

    if (response.ok) {
      return;
    }

    const details = await response.text().catch(() => "");
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseFloat(retryAfterHeader)
      : Number.NaN;
    const isRetriable = response.status === 429 || response.status >= 500;

    if (!isRetriable || attempt === maxAttempts) {
      throw new Error(details || `Failed to send email (${response.status}).`);
    }

    const backoffMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds * 1000)
        : 500 * 2 ** (attempt - 1);
    await sleep(backoffMs);
  }
};

const runAutoCloseMeetings = async (
  adminClient: SupabaseClient
): Promise<{ closedCount: number; errors: string[] }> => {
  const errors: string[] = [];
  const now = new Date();
  let closedCount = 0;

  const { data: activeSessions, error: sessionsError } = await adminClient
    .from("zoom_meeting_sessions")
    .select(
      `
      id,
      course_class_id,
      zoom_meeting_id,
      course_class:course_classes(starts_at, duration_hours)
    `
    )
    .is("ended_at", null);

  if (sessionsError) {
    return {
      closedCount,
      errors: [`Failed to load meetings for auto-close: ${sessionsError.message}`],
    };
  }

  for (const session of activeSessions ?? []) {
    const courseClass = Array.isArray(session.course_class)
      ? session.course_class[0]
      : session.course_class;

    if (!courseClass) {
      continue;
    }

    const startsAt = new Date(String(courseClass.starts_at));
    const durationHoursRaw =
      typeof courseClass.duration_hours === "number"
        ? courseClass.duration_hours
        : Number.parseFloat(String(courseClass.duration_hours || 1));
    const durationHours = Number.isFinite(durationHoursRaw)
      ? durationHoursRaw
      : 1;
    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);

    if (now <= endsAt) {
      continue;
    }

    try {
      await deleteZoomMeeting(String(session.zoom_meeting_id));
    } catch (error) {
      errors.push(
        `Failed to delete Zoom meeting ${String(session.zoom_meeting_id)}: ${
          error instanceof Error ? error.message : "Unknown Zoom delete error"
        }`
      );
    }

    const endedAt = now.toISOString();
    const { error: markEndedError } = await adminClient
      .from("zoom_meeting_sessions")
      .update({ ended_at: endedAt })
      .eq("id", String(session.id));

    if (markEndedError) {
      errors.push(
        `Failed to mark meeting session ended (${String(session.id)}): ${
          markEndedError.message
        }`
      );
      continue;
    }

    const { error: clearClassError } = await adminClient
      .from("course_classes")
      .update({
        zoom_meeting_id: null,
        zoom_start_url: null,
        zoom_join_url: null,
      })
      .eq("id", String(session.course_class_id));

    if (clearClassError) {
      errors.push(
        `Failed to clear class Zoom fields (${String(session.course_class_id)}): ${
          clearClassError.message
        }`
      );
      continue;
    }

    closedCount += 1;
  }

  return { closedCount, errors };
};

export async function POST(request: NextRequest) {
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Missing CRON_SECRET." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  const providedSecret = bearerToken || headerSecret;

  if (!providedSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase server configuration." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const autoCloseResult = await runAutoCloseMeetings(adminClient);

  let discordSync: DiscordSyncResult;
  try {
    discordSync = await runDiscordSync({ adminClient });
  } catch (error) {
    discordSync = {
      enabled: true,
      skippedReason: null,
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
      errors: [
        error instanceof Error
          ? error.message
          : "Unknown Discord sync failure.",
      ],
    };
  }

  const emailRemindersEnabled = Boolean(resendApiKey && resendFrom);
  const reminderSkippedReason = emailRemindersEnabled
    ? null
    : "Missing RESEND_API_KEY or RESEND_FROM.";

  const discordRemindersEnabled = Boolean(discordBotToken && discordGuildId);
  let discordReminderSkippedReason: string | null = null;
  let discordCourseTargetByCourseId = new Map<string, DiscordCourseReminderTarget>();
  let guildChannels: DiscordGuildChannel[] = [];
  let guildRoles: DiscordRole[] = [];
  let botUserId: string | null = null;

  const executivesChannelName =
    String(process.env.DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME ?? "").trim() ||
    defaultExecutivesChannelName;
  const foundersChannelName = "founders";
  let executivesChannelId: string | null = null;
  let foundersChannelId: string | null = null;
  let founderRoleId: string | null = null;
  let ceoRoleId: string | null = null;
  let cooRoleId: string | null = null;

  if (!discordRemindersEnabled) {
    discordReminderSkippedReason =
      "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID.";
  } else {
    try {
      guildChannels = await listDiscordGuildChannels(discordGuildId);
      guildRoles = await listDiscordGuildRoles(discordGuildId);
      const botUser = await getDiscordCurrentUser();
      botUserId = botUser.id;
      discordCourseTargetByCourseId = buildDiscordCourseTargetMap(
        guildChannels,
        discordGuildId,
        guildRoles
      );
      const execChannel = guildChannels.find(
        (ch) => ch.type === discordTextChannelType && ch.name === executivesChannelName
      );
      executivesChannelId = execChannel?.id ?? null;
      const foundersChannel = guildChannels.find(
        (ch) => ch.type === discordTextChannelType && ch.name === foundersChannelName
      );
      foundersChannelId = foundersChannel?.id ?? null;
      const founderRole = guildRoles.find((r) => r.name === "Founder");
      founderRoleId = founderRole?.id ?? null;
      const ceoRole = guildRoles.find((r) => r.name === "CEO");
      ceoRoleId = ceoRole?.id ?? null;
      const cooRole = guildRoles.find((r) => r.name === "COO");
      cooRoleId = cooRole?.id ?? null;
    } catch (error) {
      discordReminderSkippedReason =
        error instanceof Error
          ? `Failed to load Discord channels: ${error.message}`
          : "Failed to load Discord channels.";
    }
  }

  const base = floorToMinuteBoundary(new Date());
  let candidates: CandidateReminder[] = [];

  for (const target of reminderTargets) {
    const targetTime = new Date(
      base.getTime() + target.minutesBeforeStart * 60 * 1000
    );
    // GitHub cron can drift a few minutes. We include a small catch-up window
    // and rely on dedupe logs to prevent duplicate sends.
    const windowStart = new Date(
      targetTime.getTime() - target.lowerBoundDriftMinutes * 60 * 1000
    );
    const windowEnd = new Date(targetTime.getTime() + 1 * 60 * 1000);

    const { data: classes, error: classError } = await adminClient
      .from("course_classes")
      .select(
        "id, title, starts_at, duration_hours, course_id, course:courses!inner(id, title, short_name, created_by, created_by_name, created_by_email)"
      )
      .is("courses.deleted_at", null)
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString());

    if (classError) {
      return NextResponse.json(
        {
          error: classError.message ?? "Failed to load classes.",
          discordSync,
        },
        { status: 500 }
      );
    }

    for (const classRow of (classes ?? []) as ClassRow[]) {
      const course = readCourse(classRow.course);
      if (course && !course.created_by_name && !course.created_by_email) {
        continue;
      }
      candidates.push({
        reminderType: target.type,
        reminderLabel: target.label,
        classRow,
      });
    }
  }

  // Deduplicate reminders using logs to prevent multiple sends during the drift window
  const candidateClassIdsForLogs = Array.from(
    new Set(candidates.map((c) => c.classRow.id))
  );
  if (candidateClassIdsForLogs.length > 0) {
    const { data: existingLogs } = await adminClient
      .from("class_reminder_logs")
      .select("class_id, reminder_type")
      .in("class_id", candidateClassIdsForLogs);

    if (existingLogs) {
      const logSet = new Set(
        existingLogs.map((l) => `${l.class_id}:${l.reminder_type}`)
      );
      candidates = candidates.filter(
        (c) => !logSet.has(`${c.classRow.id}:${c.reminderType}`)
      );
    }
  }

  const liveRecoveryNow = floorToMinuteBoundary(new Date());
  const liveRecoverySearchStart = new Date(liveRecoveryNow.getTime() - 8 * 60 * 60 * 1000);
  const liveRecoverySearchEnd = new Date(liveRecoveryNow.getTime() + 15 * 60 * 1000);
  const { data: potentialLiveClasses, error: potentialLiveClassesError } = await adminClient
    .from("course_classes")
    .select(
      "id, title, starts_at, duration_hours, course_id, course:courses!inner(id, title, short_name, created_by, created_by_name, created_by_email)"
    )
    .is("courses.deleted_at", null)
    .gte("starts_at", liveRecoverySearchStart.toISOString())
    .lt("starts_at", liveRecoverySearchEnd.toISOString())
    .order("starts_at", { ascending: true });

  if (potentialLiveClassesError) {
    return NextResponse.json(
      {
        error: potentialLiveClassesError.message ?? "Failed to load active classes for live channel recovery.",
        discordSync,
      },
      { status: 500 }
    );
  }

  const classesInLiveWindow = ((potentialLiveClasses ?? []) as ClassRow[]).filter((classRow) => {
    const startsAt = new Date(classRow.starts_at);
    const durationHoursRaw =
      typeof classRow.duration_hours === "number"
        ? classRow.duration_hours
        : Number.parseFloat(String(classRow.duration_hours || 1));
    const durationHours = Number.isFinite(durationHoursRaw) ? durationHoursRaw : 1;
    const startsMs = startsAt.getTime();
    const endsMs = startsMs + durationHours * 60 * 60 * 1000;
    const earlyAccessMs = 15 * 60 * 1000;
    return (
      Number.isFinite(startsMs) &&
      liveRecoveryNow.getTime() >= startsMs - earlyAccessMs &&
      liveRecoveryNow.getTime() <= endsMs
    );
  });

  // Absence follow-ups: classes whose computed end fell 10-60 minutes ago. The
  // 10-minute grace lets the attendance trail and stragglers settle; the 60-minute
  // lookback tolerates cron hiccups; the dedupe log prevents double sends.
  const followUpNowMs = liveRecoveryNow.getTime();
  const followUpEndWindowStartMs = followUpNowMs - 60 * 60 * 1000;
  const followUpEndWindowEndMs = followUpNowMs - 10 * 60 * 1000;

  let recentlyEndedClasses: ClassRow[] = [];
  {
    const { data: potentialEndedClasses, error: endedClassesError } = await adminClient
      .from("course_classes")
      .select(
        "id, title, starts_at, duration_hours, course_id, course:courses!inner(id, title, short_name, created_by, created_by_name, created_by_email)"
      )
      .is("courses.deleted_at", null)
      .gte("starts_at", new Date(followUpEndWindowStartMs - 8 * 60 * 60 * 1000).toISOString())
      .lt("starts_at", new Date(followUpEndWindowEndMs).toISOString());

    if (endedClassesError) {
      // Absence follow-ups are best-effort; never fail the whole cron for them.
      console.error("Failed to load ended classes for absence follow-ups:", endedClassesError);
    } else {
      recentlyEndedClasses = ((potentialEndedClasses ?? []) as ClassRow[]).filter((classRow) => {
        const startsMs = new Date(classRow.starts_at).getTime();
        const durationHoursRaw =
          typeof classRow.duration_hours === "number"
            ? classRow.duration_hours
            : Number.parseFloat(String(classRow.duration_hours || 1));
        const durationHours = Number.isFinite(durationHoursRaw) ? durationHoursRaw : 1;
        const endsMs = startsMs + durationHours * 60 * 60 * 1000;
        return (
          Number.isFinite(startsMs) &&
          endsMs >= followUpEndWindowStartMs &&
          endsMs <= followUpEndWindowEndMs
        );
      });
    }
  }

  // Build first class date map for all courses that might need reminders, live
  // recovery, or absence follow-ups.
  const courseIdsInCandidates = Array.from(
    new Set([
      ...candidates.map((c) => c.classRow.course_id),
      ...classesInLiveWindow.map((classRow) => classRow.course_id),
      ...recentlyEndedClasses.map((classRow) => classRow.course_id),
    ])
  );
  const firstClassDateByCourseId = await buildFirstClassDateMap(
    adminClient,
    courseIdsInCandidates
  );

  const courseIds = Array.from(
    new Set([
      ...candidates.map((item) => item.classRow.course_id),
      ...classesInLiveWindow.map((classRow) => classRow.course_id),
      ...recentlyEndedClasses.map((classRow) => classRow.course_id),
    ])
  );
  const { data: enrollments, error: enrollmentError } = courseIds.length > 0
    ? await adminClient
      .from("course_enrollments")
      .select("course_id, student_id, student_email")
      .in("course_id", courseIds)
    : { data: [], error: null };

  if (enrollmentError) {
    return NextResponse.json(
      {
        error: enrollmentError.message ?? "Failed to load enrollments.",
        discordSync,
      },
      { status: 500 }
    );
  }

  const enrollmentsByCourseId = new Map<string, string[]>();
  const studentDiscordIdsByCourseId = new Map<string, string[]>();
  const studentIds = new Set<string>();
  for (const enrollment of enrollments ?? []) {
    const courseId = String(enrollment.course_id ?? "").trim();
    if (!courseId) {
      continue;
    }
    const studentId = String(enrollment.student_id ?? "").trim();
    if (studentId) {
      studentIds.add(studentId);
    }
    const email = String(enrollment.student_email ?? "").trim();
    if (!email) {
      continue;
    }
    const current = enrollmentsByCourseId.get(courseId) ?? [];
    current.push(email);
    enrollmentsByCourseId.set(courseId, current);
  }

  const studentEmailById = new Map<string, string>();
  const studentDiscordById = new Map<string, string>();
  const studentNameById = new Map<string, string>();
  if (studentIds.size > 0) {
    const { data: studentRows } = await adminClient
      .from("app_users")
      .select("id, email, full_name, discord_user_id")
      .in("id", Array.from(studentIds));
    for (const student of studentRows ?? []) {
      const studentId = String(student.id ?? "").trim();
      const email = String(student.email ?? "").trim();
      if (studentId && email) {
        studentEmailById.set(studentId, email);
      }
      const fullName = String(student.full_name ?? "").trim();
      if (studentId && fullName) {
        studentNameById.set(studentId, fullName);
      }
      const discordUserId = String(student.discord_user_id ?? "").trim();
      if (studentId && discordUserId) {
        studentDiscordById.set(studentId, discordUserId);
      }
    }

    for (const enrollment of enrollments ?? []) {
      const courseId = String(enrollment.course_id ?? "").trim();
      const studentId = String(enrollment.student_id ?? "").trim();
      if (!courseId || !studentId) {
        continue;
      }
      const canonicalEmail = studentEmailById.get(studentId);
      if (!canonicalEmail) {
        continue;
      }
      const current = enrollmentsByCourseId.get(courseId) ?? [];
      current.push(canonicalEmail);
      enrollmentsByCourseId.set(courseId, current);

      const discordId = studentDiscordById.get(studentId);
      if (discordId) {
        const currentDiscord = studentDiscordIdsByCourseId.get(courseId) ?? [];
        currentDiscord.push(discordId);
        studentDiscordIdsByCourseId.set(courseId, currentDiscord);
      }
    }

  }

  // Per-student enrollment details for absence classification. Built from ALL
  // enrollment rows: rows without an app_users match still land here (as
  // unverifiable, since no Discord link can exist for them).
  type EnrolledStudentDetail = {
    userId: string | null;
    email: string;
    fullName: string;
    discordUserId: string | null;
  };
  const studentDetailByCourseId = new Map<string, EnrolledStudentDetail[]>();
  {
    const seenByCourse = new Map<string, Set<string>>();
    for (const enrollment of enrollments ?? []) {
      const courseId = String(enrollment.course_id ?? "").trim();
      if (!courseId) {
        continue;
      }
      const studentId = String(enrollment.student_id ?? "").trim();
      const email =
        (studentId ? studentEmailById.get(studentId) : undefined) ??
        String(enrollment.student_email ?? "").trim();
      if (!email) {
        continue;
      }
      const dedupeKey = studentId || email.toLowerCase();
      const seen = seenByCourse.get(courseId) ?? new Set<string>();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      seenByCourse.set(courseId, seen);

      const details = studentDetailByCourseId.get(courseId) ?? [];
      details.push({
        userId: studentId || null,
        email,
        fullName: (studentId ? studentNameById.get(studentId) : undefined) ?? "",
        discordUserId: (studentId ? studentDiscordById.get(studentId) : undefined) ?? null,
      });
      studentDetailByCourseId.set(courseId, details);
    }
  }

  const missingTutorIds = Array.from(
    new Set(
      [
        ...candidates.map((item) => item.classRow),
        ...classesInLiveWindow,
        ...recentlyEndedClasses,
      ]
        .map((classRow) => readCourse(classRow.course))
        .filter(Boolean)
        .filter((course) => !course?.created_by_email && course?.created_by)
        .map((course) => course!.created_by as string)
    )
  );

  const tutorEmailById = new Map<string, string>();
  if (missingTutorIds.length > 0) {
    const { data: tutorRows } = await adminClient
      .from("app_users")
      .select("id, email")
      .in("id", missingTutorIds);
    for (const tutor of tutorRows ?? []) {
      const email = String(tutor.email ?? "").trim();
      if (email) {
        tutorEmailById.set(tutor.id as string, email);
      }
    }
  }

  // Look up tutor Discord IDs for follow-up messages.
  const allTutorIds = Array.from(
    new Set(
      [
        ...candidates.map((item) => item.classRow),
        ...classesInLiveWindow,
        ...recentlyEndedClasses,
      ]
        .map((classRow) => readCourse(classRow.course))
        .filter(Boolean)
        .filter((course) => course?.created_by)
        .map((course) => course!.created_by as string)
    )
  );
  const tutorDiscordIdById = new Map<string, string>();
  const tutorStrikeCountById = new Map<string, number>();
  const tutorRoleById = new Map<string, UserRole>();
  if (allTutorIds.length > 0) {
    const { data: tutorDiscordRows } = await adminClient
      .from("app_users")
      .select("id, email, role, discord_user_id, strike_count")
      .in("id", allTutorIds);
    for (const tutor of tutorDiscordRows ?? []) {
      const tutorId = String(tutor.id ?? "").trim();
      const email = String(tutor.email ?? "").trim();
      if (tutorId && email) {
        tutorEmailById.set(tutorId, email);
      }
      if (tutorId) {
        tutorRoleById.set(
          tutorId,
          resolveUserRole(email || tutorEmailById.get(tutorId) || null, String(tutor.role ?? "") || null)
        );
      }
      const discordId = String(tutor.discord_user_id ?? "").trim();
      if (tutorId && discordId) {
        tutorDiscordIdById.set(tutorId, discordId);
      }
      const strikeCount = Number(tutor.strike_count) || 0;
      if (tutorId && strikeCount > 0) {
        tutorStrikeCountById.set(tutorId, strikeCount);
      }
    }
  }

  const ensureLiveCategory = async (): Promise<string | null> => {
    if (!discordRemindersEnabled || discordReminderSkippedReason || !discordGuildId) {
      return null;
    }

    let liveCategory = guildChannels.find(
      (ch) => ch.type === discordCategoryChannelType && ch.name === defaultLiveCategoryName
    );

    if (!liveCategory) {
      liveCategory = await createDiscordGuildChannel(discordGuildId, {
        name: defaultLiveCategoryName,
        type: discordCategoryChannelType,
      });
      guildChannels.push(liveCategory);
    }

    const textCategory = guildChannels.find(
      (ch) => ch.type === discordCategoryChannelType && ch.name === defaultTextCategoryName
    );

    const topLevelChannels = guildChannels
      .filter((ch) => !ch.parent_id)
      .sort((left, right) => {
        const positionDiff = Number(left.position ?? 0) - Number(right.position ?? 0);
        return positionDiff || left.id.localeCompare(right.id);
      });
    const liveIndex = topLevelChannels.findIndex((ch) => ch.id === liveCategory.id);
    const textIndex = textCategory
      ? topLevelChannels.findIndex((ch) => ch.id === textCategory.id)
      : -1;
    const isLiveDirectlyAboveText = liveIndex >= 0 && textIndex >= 0 && liveIndex + 1 === textIndex;

    if (textCategory && !isLiveDirectlyAboveText) {
      const textPos = Number(textCategory.position ?? 1);
      await reorderDiscordChannels(discordGuildId, [
        { id: liveCategory.id, position: Math.max(0, textPos) },
        { id: textCategory.id, position: Math.max(1, textPos + 1) },
      ]);
      guildChannels = await listDiscordGuildChannels(discordGuildId);
    }

    return liveCategory.id;
  };

  if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId) {
    const { data: activeLiveChannels } = await adminClient
      .from("discord_live_class_channels")
      .select("id, class_id, discord_channel_id, tutor_discord_user_id, ends_at")
      .is("deleted_at", null);

    for (const liveChannel of activeLiveChannels ?? []) {
      const endsAtMs = new Date(String(liveChannel.ends_at)).getTime();
      if (Number.isNaN(endsAtMs) || Date.now() <= endsAtMs) {
        continue;
      }

      let tutorVoiceChannelId: string | null;
      try {
        tutorVoiceChannelId = await getDiscordUserVoiceChannelId(
          discordGuildId,
          String(liveChannel.tutor_discord_user_id)
        );
      } catch {
        continue;
      }

      if (tutorVoiceChannelId === String(liveChannel.discord_channel_id)) {
        continue;
      }

      try {
        await deleteDiscordChannel(String(liveChannel.discord_channel_id));
      } catch {
        // Channel may already be gone; mark as deleted regardless.
      }

      await adminClient
        .from("discord_live_class_channels")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", String(liveChannel.id));
    }
  }

  let sentDiscordFollowUpCount = 0;

  let sentClassCount = 0;
  let sentEmailCount = 0;
  let sentDiscordReminderCount = 0;
  const failedClasses: { classId: string; reason: string }[] = [];
  const discordReminderDeliveryEnabled =
    discordRemindersEnabled && !discordReminderSkippedReason;

  const liveChannelRecovery: {
    activeRows: number;
    recreated: number;
    skipped: { classId: string; reason: string }[];
  } = { activeRows: 0, recreated: 0, skipped: [] };

  // Recover live voice channels that should currently exist but whose Discord
  // channel is missing (e.g. it was deleted while the server was in a bad state).
  // This runs every tick and is independent of reminder de-duplication, so a class
  // that is already in session self-heals instead of staying broken.
  if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId && botUserId) {
    const nowMs = Date.now();
    const earlyAccessLeadMs = 15 * 60 * 1000;
    const studentAccessLeadMs = 5 * 60 * 1000;

    // Rows whose class has not yet ended. We intentionally do NOT filter on
    // deleted_at: a row may have been marked deleted prematurely while its channel
    // was being wrongly removed, and we still want to restore it mid-class.
    const { data: liveRows } = await adminClient
      .from("discord_live_class_channels")
      .select("id, class_id, course_id, discord_channel_id, tutor_discord_user_id, starts_at, ends_at")
      .gte("ends_at", new Date(nowMs).toISOString());

    const liveRowsByClassId = new Map(
      (liveRows ?? []).map((row) => [String(row.class_id), row])
    );
    const missingLiveRows = classesInLiveWindow
      .filter((classRow) => !liveRowsByClassId.has(classRow.id))
      .filter((classRow) => {
        const course = readCourse(classRow.course);
        if (!course) {
          liveChannelRecovery.skipped.push({ classId: classRow.id, reason: "missing course" });
          return false;
        }
        const tutorEmail =
          String(course.created_by_email ?? "").trim() ||
          (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
        const tutorRole = course.created_by
          ? tutorRoleById.get(course.created_by) ?? resolveRoleByEmail(tutorEmail)
          : resolveRoleByEmail(tutorEmail);
        const firstClassDate = firstClassDateByCourseId.get(classRow.course_id) ?? null;
        if (isFounderRole(tutorRole)) {
          liveChannelRecovery.skipped.push({ classId: classRow.id, reason: "founder/CEO/COO-taught legacy class" });
          return false;
        }
        if (!shouldUseDiscordVoiceSystem(firstClassDate)) {
          liveChannelRecovery.skipped.push({ classId: classRow.id, reason: "course does not use Discord voice system" });
          return false;
        }
        return true;
      })
      .map((classRow) => {
        const course = readCourse(classRow.course);
        const startsAtMs = new Date(classRow.starts_at).getTime();
        const durationHoursRaw =
          typeof classRow.duration_hours === "number"
            ? classRow.duration_hours
            : Number.parseFloat(String(classRow.duration_hours || 1));
        const durationHours = Number.isFinite(durationHoursRaw) ? durationHoursRaw : 1;
        return {
          id: null,
          class_id: classRow.id,
          course_id: classRow.course_id,
          discord_channel_id: "",
          tutor_discord_user_id: course?.created_by
            ? tutorDiscordIdById.get(course.created_by) ?? ""
            : "",
          starts_at: classRow.starts_at,
          ends_at: new Date(startsAtMs + durationHours * 60 * 60 * 1000).toISOString(),
        };
      });

    const liveRowsForRecovery = [...(liveRows ?? []), ...missingLiveRows];
    liveChannelRecovery.activeRows = liveRowsForRecovery.length;

    const recoverable = liveRowsForRecovery.filter((row) => {
      const classId = String(row.class_id);
      const startsMs = new Date(String(row.starts_at)).getTime();
      const endsMs = new Date(String(row.ends_at)).getTime();
      if (Number.isNaN(startsMs) || Number.isNaN(endsMs)) {
        liveChannelRecovery.skipped.push({ classId, reason: "invalid start/end dates" });
        return false;
      }
      // The channel should exist from the tutor early-access window until class end.
      if (nowMs < startsMs - earlyAccessLeadMs) {
        liveChannelRecovery.skipped.push({ classId, reason: "more than 15 min before start" });
        return false;
      }
      if (nowMs > endsMs) {
        liveChannelRecovery.skipped.push({ classId, reason: "class already ended" });
        return false;
      }
      // Only recover when the recorded channel is actually gone from the guild.
      const recordedChannelId = String(row.discord_channel_id ?? "").trim();
      if (recordedChannelId && guildChannels.some((ch) => ch.id === recordedChannelId)) {
        liveChannelRecovery.skipped.push({ classId, reason: "channel already exists in guild" });
        return false;
      }
      return true;
    });

    if (recoverable.length > 0) {
      const recoverCourseIds = Array.from(
        new Set(recoverable.map((row) => String(row.course_id)).filter(Boolean))
      );
      const titleByCourseId = new Map<string, string>();
      const studentDiscordIdsByCourse = new Map<string, string[]>();

      if (recoverCourseIds.length > 0) {
        const { data: courseRows } = await adminClient
          .from("courses")
          .select("id, title")
          .in("id", recoverCourseIds);
        for (const courseRow of courseRows ?? []) {
          titleByCourseId.set(String(courseRow.id), String(courseRow.title ?? ""));
        }

        const { data: recoverEnrollments } = await adminClient
          .from("course_enrollments")
          .select("course_id, student_id")
          .in("course_id", recoverCourseIds);
        const recoverStudentIds = Array.from(
          new Set((recoverEnrollments ?? []).map((e) => String(e.student_id ?? "")).filter(Boolean))
        );
        const discordByStudentId = new Map<string, string>();
        if (recoverStudentIds.length > 0) {
          const { data: studentRows } = await adminClient
            .from("app_users")
            .select("id, discord_user_id")
            .in("id", recoverStudentIds);
          for (const student of studentRows ?? []) {
            const discordId = String(student.discord_user_id ?? "").trim();
            if (discordId) {
              discordByStudentId.set(String(student.id), discordId);
            }
          }
        }
        for (const enrollment of recoverEnrollments ?? []) {
          const discordId = discordByStudentId.get(String(enrollment.student_id ?? ""));
          if (!discordId) {
            continue;
          }
          const courseId = String(enrollment.course_id ?? "");
          const current = studentDiscordIdsByCourse.get(courseId) ?? [];
          current.push(discordId);
          studentDiscordIdsByCourse.set(courseId, current);
        }
      }

      const liveCategoryId = await ensureLiveCategory();
      if (!liveCategoryId) {
        for (const row of recoverable) {
          liveChannelRecovery.skipped.push({
            classId: String(row.class_id),
            reason: "could not ensure Live category",
          });
        }
      } else {
        for (const row of recoverable) {
          const tutorDiscordId = String(row.tutor_discord_user_id ?? "").trim();
          if (!tutorDiscordId) {
            liveChannelRecovery.skipped.push({
              classId: String(row.class_id),
              reason: "no tutor Discord id on record",
            });
            continue;
          }
          const courseId = String(row.course_id);
          const startsMs = new Date(String(row.starts_at)).getTime();
          // Students only get access from 5 minutes before the start; before that
          // it stays tutor-only, matching the normal early-access behaviour.
          const grantStudents = nowMs >= startsMs - studentAccessLeadMs;
          const studentDiscordUserIds = grantStudents
            ? Array.from(new Set(studentDiscordIdsByCourse.get(courseId) ?? []))
            : [];
          try {
            const permissionOverwrites = buildLiveVoicePermissionOverwrites({
              guildId: discordGuildId,
              botUserId,
              ceoRoleId,
              cooRoleId,
              tutorDiscordUserId: tutorDiscordId,
              studentDiscordUserIds,
            });
            const recreatedChannel = await createDiscordGuildChannel(discordGuildId, {
              name: normalizeVoiceChannelName(titleByCourseId.get(courseId) || "Class", String(row.class_id)),
              type: discordVoiceChannelType,
              parent_id: liveCategoryId,
              permission_overwrites: permissionOverwrites,
            });
            guildChannels.push(recreatedChannel);
            if (row.id) {
              await adminClient
                .from("discord_live_class_channels")
                .update({ discord_channel_id: recreatedChannel.id, deleted_at: null })
                .eq("id", String(row.id));
            } else {
              await adminClient.from("discord_live_class_channels").insert({
                class_id: String(row.class_id),
                course_id: String(row.course_id),
                discord_channel_id: recreatedChannel.id,
                tutor_discord_user_id: tutorDiscordId,
                starts_at: String(row.starts_at),
                ends_at: String(row.ends_at),
              });
            }
            liveChannelRecovery.recreated += 1;
          } catch (error) {
            const reason = error instanceof Error ? error.message : "Unknown error.";
            liveChannelRecovery.skipped.push({
              classId: String(row.class_id),
              reason: `failed to recreate channel: ${reason}`,
            });
            failedClasses.push({
              classId: String(row.class_id),
              reason: `Failed to recover live voice channel: ${reason}`,
            });
          }
        }
      }
    }
  }

  if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId) {
    try {
      guildChannels = await listDiscordGuildChannels(discordGuildId);
      const liveCategory = guildChannels.find(
        (ch) => ch.type === discordCategoryChannelType && ch.name === defaultLiveCategoryName
      );
      if (liveCategory) {
        const hasLiveChildren = guildChannels.some(
          (ch) => String(ch.parent_id ?? "") === liveCategory.id
        );
        const { data: remainingLiveRows } = await adminClient
          .from("discord_live_class_channels")
          .select("id")
          .is("deleted_at", null)
          .limit(1);

        if (!hasLiveChildren && (remainingLiveRows ?? []).length === 0) {
          await deleteDiscordChannel(liveCategory.id);
          guildChannels = guildChannels.filter((ch) => ch.id !== liveCategory.id);
        }
      }
    } catch (error) {
      failedClasses.push({
        classId: "live-category-cleanup",
        reason: `Failed to clean up empty Live category: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  // Auto-attendance: record which enrolled students (and the tutor) are currently
  // in their class's live Discord voice channel. Runs every tick while a class is
  // in session; each participant is polled only until first detected, which bounds
  // the number of Discord API calls.
  let attendanceRecorded = 0;
  if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId) {
    try {
      const attendanceNow = Date.now();
      const attendanceLeadMs = 5 * 60 * 1000;
      const attendanceTrailMs = 2 * 60 * 1000;

      // Classes whose live voice channel should currently be active.
      const { data: liveSessions } = await adminClient
        .from("discord_live_class_channels")
        .select("class_id, course_id, discord_channel_id, tutor_discord_user_id, starts_at, ends_at")
        .is("deleted_at", null)
        .lte("starts_at", new Date(attendanceNow + attendanceLeadMs).toISOString())
        .gte("ends_at", new Date(attendanceNow - attendanceTrailMs).toISOString());

      const sessions = liveSessions ?? [];
      if (sessions.length > 0) {
        const sessionCourseIds = Array.from(
          new Set(sessions.map((s) => String(s.course_id)).filter(Boolean))
        );
        const sessionClassIds = sessions.map((s) => String(s.class_id)).filter(Boolean);

        // Enrolled students (app_users id + Discord id) per in-session course.
        const { data: attendanceEnrollments } = await adminClient
          .from("course_enrollments")
          .select("course_id, student_id")
          .in("course_id", sessionCourseIds);
        const attendanceStudentIds = Array.from(
          new Set((attendanceEnrollments ?? []).map((e) => String(e.student_id ?? "")).filter(Boolean))
        );
        const discordByStudentId = new Map<string, string>();
        if (attendanceStudentIds.length > 0) {
          const { data: attendanceStudentRows } = await adminClient
            .from("app_users")
            .select("id, discord_user_id")
            .in("id", attendanceStudentIds);
          for (const student of attendanceStudentRows ?? []) {
            const discordId = String(student.discord_user_id ?? "").trim();
            if (discordId) {
              discordByStudentId.set(String(student.id), discordId);
            }
          }
        }
        const studentsByCourse = new Map<string, { userId: string; discordId: string }[]>();
        for (const enrollment of attendanceEnrollments ?? []) {
          const courseId = String(enrollment.course_id ?? "");
          const studentId = String(enrollment.student_id ?? "");
          const discordId = discordByStudentId.get(studentId);
          if (!courseId || !studentId || !discordId) {
            continue;
          }
          const current = studentsByCourse.get(courseId) ?? [];
          current.push({ userId: studentId, discordId });
          studentsByCourse.set(courseId, current);
        }

        // Tutor (course creator) app_users id per in-session course.
        const createdByByCourse = new Map<string, string>();
        const { data: sessionCourses } = await adminClient
          .from("courses")
          .select("id, created_by")
          .in("id", sessionCourseIds);
        for (const courseRow of sessionCourses ?? []) {
          const createdBy = String(courseRow.created_by ?? "").trim();
          if (createdBy) {
            createdByByCourse.set(String(courseRow.id), createdBy);
          }
        }

        // Participants already recorded for these classes (skip to bound API calls).
        const recordedKeys = new Set<string>();
        if (sessionClassIds.length > 0) {
          const { data: existingAttendance } = await adminClient
            .from("class_attendance")
            .select("class_id, user_id")
            .in("class_id", sessionClassIds);
          for (const row of existingAttendance ?? []) {
            recordedKeys.add(`${row.class_id}:${row.user_id}`);
          }
        }

        const nowIso = new Date(attendanceNow).toISOString();
        let pollBudget = 300; // hard cap per tick to avoid long-running requests

        for (const session of sessions) {
          if (pollBudget <= 0) {
            break;
          }
          const classId = String(session.class_id);
          const courseId = String(session.course_id);
          const channelId = String(session.discord_channel_id ?? "").trim();
          if (!channelId) {
            continue;
          }

          const participants: { userId: string; discordId: string; isTutor: boolean }[] = [];
          const tutorUserId = createdByByCourse.get(courseId);
          const tutorDiscordId = String(session.tutor_discord_user_id ?? "").trim();
          if (tutorUserId && tutorDiscordId) {
            participants.push({ userId: tutorUserId, discordId: tutorDiscordId, isTutor: true });
          }
          for (const student of studentsByCourse.get(courseId) ?? []) {
            // A student who is also the creator is already covered as the tutor.
            if (student.userId === tutorUserId) {
              continue;
            }
            participants.push({ userId: student.userId, discordId: student.discordId, isTutor: false });
          }

          for (const participant of participants) {
            if (pollBudget <= 0) {
              break;
            }
            if (recordedKeys.has(`${classId}:${participant.userId}`)) {
              continue;
            }
            pollBudget -= 1;
            let currentChannelId: string | null = null;
            try {
              currentChannelId = await getDiscordUserVoiceChannelId(
                discordGuildId,
                participant.discordId
              );
            } catch {
              continue;
            }
            if (currentChannelId !== channelId) {
              continue;
            }
            const { error: upsertError } = await adminClient
              .from("class_attendance")
              .upsert(
                {
                  class_id: classId,
                  course_id: courseId,
                  user_id: participant.userId,
                  discord_user_id: participant.discordId,
                  is_tutor: participant.isTutor,
                  first_seen_at: nowIso,
                  last_seen_at: nowIso,
                },
                { onConflict: "class_id,user_id", ignoreDuplicates: true }
              );
            if (!upsertError) {
              recordedKeys.add(`${classId}:${participant.userId}`);
              attendanceRecorded += 1;
            }
          }
        }
      }
    } catch (error) {
      failedClasses.push({
        classId: "attendance",
        reason: `Failed to record attendance: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  // Absence follow-ups: after a Discord-voice class ends, email absent students,
  // nudge students with no linked Discord, and send the tutor a summary.
  const absenceFollowUps: {
    classesProcessed: number;
    absentEmails: number;
    unverifiedEmails: number;
    tutorSummaries: number;
    skipped: { classId: string; reason: string }[];
  } = { classesProcessed: 0, absentEmails: 0, unverifiedEmails: 0, tutorSummaries: 0, skipped: [] };

  if (emailRemindersEnabled && recentlyEndedClasses.length > 0) {
    try {
      const endedClassIds = recentlyEndedClasses.map((classRow) => classRow.id);
      const { data: followUpLogs } = await adminClient
        .from("class_reminder_logs")
        .select("class_id, reminder_type")
        .in("class_id", endedClassIds)
        .eq("reminder_type", "absence_follow_up");
      const alreadyLogged = new Set((followUpLogs ?? []).map((log) => String(log.class_id)));
      const pendingClasses = recentlyEndedClasses.filter(
        (classRow) => !alreadyLogged.has(classRow.id)
      );

      const attendedUserIdsByClassId = new Map<string, Set<string>>();
      const tutorPresentByClassId = new Set<string>();
      const attendanceRowCountByClassId = new Map<string, number>();
      if (pendingClasses.length > 0) {
        const { data: attendanceRows } = await adminClient
          .from("class_attendance")
          .select("class_id, user_id, is_tutor")
          .in("class_id", pendingClasses.map((classRow) => classRow.id));
        for (const row of attendanceRows ?? []) {
          const classId = String(row.class_id);
          attendanceRowCountByClassId.set(
            classId,
            (attendanceRowCountByClassId.get(classId) ?? 0) + 1
          );
          if (row.is_tutor) {
            tutorPresentByClassId.add(classId);
          } else {
            const set = attendedUserIdsByClassId.get(classId) ?? new Set<string>();
            set.add(String(row.user_id));
            attendedUserIdsByClassId.set(classId, set);
          }
        }
      }

      for (const classRow of pendingClasses) {
        const insertFollowUpLog = async () => {
          // The unique (class_id, reminder_type) constraint makes a racing
          // duplicate insert a harmless error.
          await adminClient
            .from("class_reminder_logs")
            .insert({ class_id: classRow.id, reminder_type: "absence_follow_up" });
        };
        const skip = async (reason: string) => {
          absenceFollowUps.skipped.push({ classId: classRow.id, reason });
          await insertFollowUpLog();
        };

        const course = readCourse(classRow.course);
        if (!course || (!course.created_by && !course.created_by_name && !course.created_by_email)) {
          await skip("missing tutor info");
          continue;
        }

        const tutorEmail =
          String(course.created_by_email ?? "").trim() ||
          (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
        const tutorRole = course.created_by
          ? tutorRoleById.get(course.created_by) ?? resolveRoleByEmail(tutorEmail)
          : resolveRoleByEmail(tutorEmail);
        if (isFounderRole(tutorRole)) {
          await skip("founder/CEO/COO-taught legacy class");
          continue;
        }

        const firstClassDate = firstClassDateByCourseId.get(classRow.course_id) ?? null;
        if (!shouldUseDiscordVoiceSystem(firstClassDate)) {
          await skip("course does not use Discord voice system");
          continue;
        }

        const students = (studentDetailByCourseId.get(classRow.course_id) ?? []).filter(
          (student) => student.userId !== course.created_by
        );
        if (students.length === 0) {
          await skip("no enrolled students");
          continue;
        }

        // Critical false-positive guard: if attendance tracking recorded nobody at
        // all (e.g. the voice channel was never created), do not email anyone.
        if ((attendanceRowCountByClassId.get(classRow.id) ?? 0) === 0) {
          await skip("no attendance rows recorded (tracking failed or nobody joined)");
          continue;
        }

        const attendedUserIds = attendedUserIdsByClassId.get(classRow.id) ?? new Set<string>();
        const attended = students.filter(
          (student) => student.userId && attendedUserIds.has(student.userId)
        );
        const absent = students.filter(
          (student) => student.userId && student.discordUserId && !attendedUserIds.has(student.userId)
        );
        const unverifiable = students.filter((student) => !student.discordUserId);

        const courseTitleRaw = String(course.title ?? "").trim() || "Course";
        const classTitleRaw = String(classRow.title ?? "").trim() || "Class";
        const courseTitle = escapeHtml(courseTitleRaw);
        const classTitle = escapeHtml(classTitleRaw);
        const isStandardClassTitle = /^class\s+\d+/i.test(classTitleRaw);
        const startLabel = escapeHtml(formatTorontoDateTime(classRow.starts_at));
        const tutorNameRaw = String(course.created_by_name ?? "").trim() || "your tutor";
        const tutorName = escapeHtml(tutorNameRaw);
        const classDetailsHtml = `
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>`;

        const failedRecipients: { email: string; reason: string }[] = [];
        let attemptedSends = 0;
        let successfulSends = 0;

        const trySend = async (to: string, subject: string, html: string) => {
          attemptedSends += 1;
          try {
            await sendEmail(to, subject, html);
            successfulSends += 1;
            await sleep(150);
            return true;
          } catch (error) {
            failedRecipients.push({
              email: to,
              reason: error instanceof Error ? error.message : "Failed to send email.",
            });
            return false;
          }
        };

        for (const student of absent) {
          const sent = await trySend(
            student.email,
            `We missed you in class today (${courseTitleRaw})`,
            `<p>Hi there,</p>
<p>Our attendance system didn't detect you in the Discord voice channel for your class:</p>
${classDetailsHtml}
<p>We understand things come up. To catch up on what was covered, please reach out to your tutor, <strong>${tutorName}</strong>.</p>
<p>If you did attend and believe this is an error, please contact your tutor so we can look into it &mdash; no further action is needed on your part.</p>
<p>Thanks,<br/>The YanLearn Team</p>`
          );
          if (sent) {
            absenceFollowUps.absentEmails += 1;
          }
        }

        for (const student of unverifiable) {
          const sent = await trySend(
            student.email,
            `Action required: connect & join Discord — we couldn't verify your attendance (${courseTitleRaw})`,
            `<p>Hi there,</p>
<p>Your class recently ended, but we <strong>could not verify your attendance</strong> because your Discord account is not connected to your YanLearn profile:</p>
${classDetailsHtml}
<p>Classes are held in our Discord server, so you must complete <strong>both</strong> of the following to attend:</p>
<ol>
  <li><strong>Connect your Discord account</strong> to your YanLearn profile.</li>
  <li><strong>Join the YanLearn Discord server.</strong></li>
</ol>
<p>To do this:</p>
<ol>
  <li>Sign in to your YanLearn account.</li>
  <li>Click your profile card in the top-right corner.</li>
  <li>Click <strong>Connect Discord</strong> and authorize your Discord account.</li>
  <li>After authorizing, you will be redirected to the server invite page &mdash; accept it to join.</li>
</ol>
<p>If you connected Discord but closed that tab before joining, open your profile card and click <strong>Join Discord Server</strong> to retry.</p>
<p><strong>Please complete both steps before your next class</strong>, otherwise you will not be able to attend and your attendance cannot be recorded.</p>
<p>Thanks,<br/>The YanLearn Team</p>`
          );
          if (sent) {
            absenceFollowUps.unverifiedEmails += 1;
          }
        }

        if (tutorEmail) {
          const renderStudents = (list: typeof students) =>
            list.length === 0
              ? "<p>None</p>"
              : `<ul>${list
                  .map(
                    (student) =>
                      `<li>${escapeHtml(
                        student.fullName ? `${student.fullName} (${student.email})` : student.email
                      )}</li>`
                  )
                  .join("")}</ul>`;
          const tutorWasPresent = tutorPresentByClassId.has(classRow.id);
          const sent = await trySend(
            tutorEmail,
            `Attendance summary: ${courseTitleRaw} — ${classTitleRaw}`,
            `<p>Hi ${tutorName},</p>
<p>Here is the attendance summary for your class:</p>
${classDetailsHtml}
<p><strong>Attended (${attended.length}):</strong></p>
${renderStudents(attended)}
<p><strong>Absent (${absent.length}):</strong> <em>enrolled with Discord linked but never joined the voice channel; they have been sent a follow-up email.</em></p>
${renderStudents(absent)}
<p><strong>Unverifiable (${unverifiable.length}):</strong> <em>no linked Discord account, so attendance cannot be tracked; they have been asked to connect Discord and join the server.</em></p>
${renderStudents(unverifiable)}
${tutorWasPresent ? "" : "<p><strong>Note:</strong> you were not detected in the class voice channel yourself, so the lists above may be unreliable for this class.</p>"}
<p>Thanks,<br/>The YanLearn Team</p>`
          );
          if (sent) {
            absenceFollowUps.tutorSummaries += 1;
          }
        }

        if (failedRecipients.length > 0) {
          failedClasses.push({
            classId: classRow.id,
            reason: `Failed absence follow-up recipients: ${failedRecipients
              .map((item) => `${item.email} (${item.reason})`)
              .join("; ")}`,
          });
        }

        // Leave unlogged only on total transient failure so the next tick retries
        // within the window; partial success matches existing reminder semantics
        // (failed recipients are not retried).
        if (!(attemptedSends > 0 && successfulSends === 0)) {
          await insertFollowUpLog();
          absenceFollowUps.classesProcessed += 1;
        }
      }
    } catch (error) {
      failedClasses.push({
        classId: "absence-follow-up",
        reason: `Failed absence follow-up pass: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  for (const candidate of candidates) {
    let wasAnyReminderSent = false;
    const { classRow, reminderType, reminderLabel } = candidate;
    const course = readCourse(classRow.course);
    if (!course) {
      continue;
    }

    const tutorStrikeCount = course.created_by
      ? tutorStrikeCountById.get(course.created_by) ?? 0
      : 0;

    if (reminderType === "six_hours" && tutorStrikeCount === 0) {
      continue;
    }

    const isStandardReminder =
      reminderType === "twenty_four_hours" || reminderType === "one_hour";
    const isCourseChannelReminder = reminderType === "one_hour" || reminderType === "five_minutes";

    const tutorEmail =
      String(course.created_by_email ?? "").trim() ||
      (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
    const tutorRole = course.created_by
      ? tutorRoleById.get(course.created_by) ?? resolveRoleByEmail(tutorEmail)
      : resolveRoleByEmail(tutorEmail);
    const isFounderTaughtClass = isFounderRole(tutorRole);
    const firstClassDate = firstClassDateByCourseId.get(classRow.course_id) ?? null;
    const usesDiscordVoiceSystem = !isFounderTaughtClass && shouldUseDiscordVoiceSystem(firstClassDate);
    const isTutorEarlyAccessReminder = reminderType === "fifteen_minutes" && usesDiscordVoiceSystem;

    const shouldSendCourseDiscordReminder =
      isCourseChannelReminder && discordReminderDeliveryEnabled;
    const shouldSendAnyEmail =
      (isStandardReminder || isTutorEarlyAccessReminder) && emailRemindersEnabled;
    const shouldSendExecutiveTutorReminder =
      (isFounderTaughtClass
        ? reminderType !== "ten_minutes" && reminderType !== "five_minutes"
        : reminderType !== "ten_minutes" && (usesDiscordVoiceSystem || reminderType !== "fifteen_minutes")) &&
      discordReminderDeliveryEnabled &&
      executivesChannelId !== null;    const shouldSendFounderChannelReminder =
      !isFounderTaughtClass &&
      (reminderType === "one_hour" || reminderType === "ten_minutes") &&
      discordReminderDeliveryEnabled &&
      foundersChannelId !== null &&
      founderRoleId !== null;

    if (
      !shouldSendCourseDiscordReminder &&
      !shouldSendAnyEmail &&
      !shouldSendExecutiveTutorReminder &&
      !shouldSendFounderChannelReminder
    ) {
      continue;
    }

    const recipients = new Set<string>();

    if (isStandardReminder) {
      for (const email of enrollmentsByCourseId.get(classRow.course_id) ?? []) {
        recipients.add(email.toLowerCase());
      }
    }

    if (tutorEmail && (isStandardReminder || isTutorEarlyAccessReminder)) {
      recipients.add(tutorEmail.toLowerCase());
    }

    if (
      !shouldSendCourseDiscordReminder &&
      !shouldSendExecutiveTutorReminder &&
      !shouldSendFounderChannelReminder &&
      recipients.size === 0
    ) {
      continue;
    }

    const classTitleRaw = String(classRow.title ?? "").trim() || "Class";
    const classTitleOrdinalRaw = formatOrdinalClass(classTitleRaw);
    const courseTitleRaw = String(course.title ?? "").trim() || "Course";
    const classTitle = escapeHtml(classTitleRaw);
    const courseTitle = escapeHtml(courseTitleRaw);
    const tutorNameRaw =
      String(course.created_by_name ?? "").trim() || "your tutor";
    const tutorName = escapeHtml(tutorNameRaw);
    const courseShortName = String(course.short_name ?? "").trim();
    const tutorNameParts = tutorNameRaw.split(/\s+/).filter(Boolean);
    const tutorFirstName = tutorNameParts[0] ?? "Tutor";
    const tutorLastInitial =
      tutorNameParts.length > 1
        ? `${tutorNameParts[tutorNameParts.length - 1][0]}`
        : "";
    const isStandardClassTitle = /^class\s+\d+/i.test(classTitleRaw);
    const breakoutRoomName =
      courseShortName.length > 0
        ? `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}: ${courseShortName}`
        : "";
    const startLabel = escapeHtml(formatTorontoDateTime(classRow.starts_at));
    let subject = "";
    let html = "";
    let discordContent = "";
    let executiveTutorContent = "";

    let voiceChannelLinkForTutor = "";

      if (isTutorEarlyAccessReminder) {
        if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId && botUserId) {
          const tutorDiscordIdForChannel = course.created_by
            ? tutorDiscordIdById.get(course.created_by) ?? ""
            : "";
          if (tutorDiscordIdForChannel) {
            const liveCategoryId = await ensureLiveCategory();
            if (liveCategoryId) {
              const { data: existingLiveRow } = await adminClient
                .from("discord_live_class_channels")
                .select("id, discord_channel_id, deleted_at")
                .eq("class_id", classRow.id)
                .single();

              let liveChannelId = "";
              if (existingLiveRow && !existingLiveRow.deleted_at) {
                liveChannelId = String(existingLiveRow.discord_channel_id ?? "").trim();
              }

              const existingChannel = liveChannelId
                ? guildChannels.find((ch) => ch.id === liveChannelId)
                : null;

              if (!existingChannel) {
                const permissionOverwrites = buildLiveVoicePermissionOverwrites({
                  guildId: discordGuildId,
                  botUserId,
                  ceoRoleId,
                  cooRoleId,
                  tutorDiscordUserId: tutorDiscordIdForChannel,
                  studentDiscordUserIds: [],
                });
                const createdVoiceChannel = await createDiscordGuildChannel(discordGuildId, {
                  name: normalizeVoiceChannelName(courseTitleRaw, classRow.id),
                  type: discordVoiceChannelType,
                  parent_id: liveCategoryId,
                  permission_overwrites: permissionOverwrites,
                });
                guildChannels.push(createdVoiceChannel);
                liveChannelId = createdVoiceChannel.id;

                const startsAtMs = new Date(classRow.starts_at).getTime();
                const durationHoursRaw =
                  typeof classRow.duration_hours === "number"
                    ? classRow.duration_hours
                    : Number.parseFloat(String(classRow.duration_hours || 1));
                const durationHours = Number.isFinite(durationHoursRaw) ? durationHoursRaw : 1;
                const endsAt = new Date(startsAtMs + durationHours * 60 * 60 * 1000);

                if (existingLiveRow) {
                  await adminClient
                    .from("discord_live_class_channels")
                    .update({
                      discord_channel_id: liveChannelId,
                      tutor_discord_user_id: tutorDiscordIdForChannel,
                      starts_at: classRow.starts_at,
                      ends_at: endsAt.toISOString(),
                      deleted_at: null,
                    })
                    .eq("id", existingLiveRow.id);
                } else {
                  await adminClient.from("discord_live_class_channels").insert({
                    class_id: classRow.id,
                    course_id: classRow.course_id,
                    discord_channel_id: liveChannelId,
                    tutor_discord_user_id: tutorDiscordIdForChannel,
                    starts_at: classRow.starts_at,
                    ends_at: endsAt.toISOString(),
                  });
                }
              }

              if (liveChannelId) {
                voiceChannelLinkForTutor = `https://discord.com/channels/${discordGuildId}/${liveChannelId}`;
              }
            }
          }
        }

        subject = `Class reminder: starts in 15 minutes (${course.title})`;
        html = `
        <p>Your class starts in <strong>15 minutes</strong>. Please join the voice channel now to prepare for your students.</p>
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
        ${voiceChannelLinkForTutor ? `<p><strong>Voice channel:</strong> <a href="${escapeHtml(voiceChannelLinkForTutor)}">${escapeHtml(voiceChannelLinkForTutor)}</a></p>` : ""}
      `;
      }

      if (isStandardReminder) {
        subject = `Class reminder: starts in ${reminderLabel} (${course.title})`;
        
        // For Discord live system, don't include meeting details in non-5-minute reminders.
        if (usesDiscordVoiceSystem) {
          html = `
        <p>Your class starts in <strong>${escapeHtml(reminderLabel)}</strong>.</p>
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></p>
        <p><strong>Tutor:</strong> ${tutorName}</p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
        <p>This class will be held on <strong>Discord</strong>. Please make sure you have connected your Discord account in your profile and joined our Discord server.</p>
        <p>You will receive a notification in the Discord server with a link to the voice channel 5 minutes before the class starts. Please make sure to join the server if you haven't already.</p>
      `;
          discordContent = [
            `Your class starts in **${escapeDiscordText(reminderLabel)}**.`,
            `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
            isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
            `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
            `**Start time (${torontoTimeZone}):** ${escapeDiscordText(
              formatTorontoDateTime(classRow.starts_at)
            )}`,
            "This class will be held on **Discord**.",
            "You will receive a notification in this server with a link to the voice channel 5 minutes before the class starts.",
            "Please make sure you are in the voice channel 5 minutes before the start time."
          ].join("\n");
        } else {
          // Legacy system (Schoolhouse or CEO tutors)
          html = `
        <p>Your class starts in <strong>${escapeHtml(reminderLabel)}</strong>.</p>
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></p>
        <p><strong>Tutor:</strong> ${tutorName}</p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
        ${
          isFounderTaughtClass
            ? `<p>Please attend the class 5 minutes before the start time on the Schoolhouse platform.</p>`
            : `<p>Please attend the class 5 minutes before the start time:</p>\n        <p>Zoom ID: ${escapeHtml(defaultZoomId)}<br/>Password: ${escapeHtml(defaultZoomPassword)}<br/>${breakoutRoomName
                ? `Breakout room: "${escapeHtml(breakoutRoomName)}"`
                : `Please join the breakout room that starts with "${escapeHtml(
                  `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}`
                )}" followed by the name of the course.`
              }</p>\n        <p><strong>Please join the breakout room immediately after joining the meeting. Do not stay in the main meeting room.</strong></p>\n        <p><strong>Please use your registered student name to log into Zoom, otherwise you may be removed by the administrator and bear the consequences of not being able to attend the class.</strong></p>`
        }
      `;
          const nonFounderDiscordInstruction = [
            "Please attend the class 5 minutes before the start time:",
            `Zoom ID: ${escapeDiscordText(defaultZoomId)}`,
            `Password: ${escapeDiscordText(defaultZoomPassword)}`,
            breakoutRoomName
              ? `Breakout room: "${escapeDiscordText(breakoutRoomName)}"`
              : `Please join the breakout room that starts with "${escapeDiscordText(
                `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}`
              )}" followed by the name of the course.`,
            "**Please join the breakout room immediately after joining the meeting. Do not stay in the main meeting room.**",
            "**Please use your registered student name to log into Zoom, otherwise you may be removed by the administrator and bear the consequences of not being able to attend the class.**",
          ].join("\n");

          discordContent = [
            `Your class starts in **${escapeDiscordText(reminderLabel)}**.`,
            `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
            isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
            `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
            `**Start time (${torontoTimeZone}):** ${escapeDiscordText(
              formatTorontoDateTime(classRow.starts_at)
            )}`,
            isFounderTaughtClass
              ? "Please attend the class 5 minutes before the start time on the Schoolhouse platform."
              : nonFounderDiscordInstruction,
          ].join("\n");
        }
      }

      if (reminderType === "five_minutes" && !isStandardReminder) {
        // For Discord live system, look up the voice channel created at the 15-minute mark.
        // If the 15-minute cron was missed, fall back to creating it now.
        if (usesDiscordVoiceSystem) {
          let voiceChannelLink = "";

          if (discordRemindersEnabled && !discordReminderSkippedReason && discordGuildId) {
            const { data: existingLiveRow } = await adminClient
              .from("discord_live_class_channels")
              .select("id, discord_channel_id, deleted_at")
              .eq("class_id", classRow.id)
              .single();

            let liveChannelId = "";
            let channelFoundInDb = false;
            if (existingLiveRow && !existingLiveRow.deleted_at) {
              const recordedChannelId = String(existingLiveRow.discord_channel_id ?? "").trim();
              // Only reuse the recorded channel if it still exists in the guild. If it
              // was removed (e.g. deleted while the server was in a bad state), fall
              // through to recreate it below instead of pointing at a dead channel.
              if (recordedChannelId && guildChannels.some((ch) => ch.id === recordedChannelId)) {
                liveChannelId = recordedChannelId;
                channelFoundInDb = true;
              }
            }

            if (!liveChannelId && botUserId) {
              const tutorDiscordIdForFallback = course.created_by
                ? tutorDiscordIdById.get(course.created_by) ?? ""
                : "";
              if (tutorDiscordIdForFallback) {
                const liveCategoryId = await ensureLiveCategory();
                if (liveCategoryId) {
                  const enrolledDiscordIds = Array.from(
                    new Set(studentDiscordIdsByCourseId.get(classRow.course_id) ?? [])
                  );
                  const permissionOverwrites = buildLiveVoicePermissionOverwrites({
                    guildId: discordGuildId,
                    botUserId,
                    ceoRoleId,
                    cooRoleId,
                    tutorDiscordUserId: tutorDiscordIdForFallback,
                    studentDiscordUserIds: enrolledDiscordIds,
                  });
                  const createdVoiceChannel = await createDiscordGuildChannel(discordGuildId, {
                    name: normalizeVoiceChannelName(courseTitleRaw, classRow.id),
                    type: discordVoiceChannelType,
                    parent_id: liveCategoryId,
                    permission_overwrites: permissionOverwrites,
                  });
                  guildChannels.push(createdVoiceChannel);
                  liveChannelId = createdVoiceChannel.id;
                  const startsAtMs = new Date(classRow.starts_at).getTime();
                  const durationHoursRaw =
                    typeof classRow.duration_hours === "number"
                      ? classRow.duration_hours
                      : Number.parseFloat(String(classRow.duration_hours || 1));
                  const durationHours = Number.isFinite(durationHoursRaw) ? durationHoursRaw : 1;
                  const endsAt = new Date(startsAtMs + durationHours * 60 * 60 * 1000);
                  if (existingLiveRow) {
                    await adminClient
                      .from("discord_live_class_channels")
                      .update({
                        discord_channel_id: liveChannelId,
                        tutor_discord_user_id: tutorDiscordIdForFallback,
                        starts_at: classRow.starts_at,
                        ends_at: endsAt.toISOString(),
                        deleted_at: null,
                      })
                      .eq("id", existingLiveRow.id);
                  } else {
                    await adminClient.from("discord_live_class_channels").insert({
                      class_id: classRow.id,
                      course_id: classRow.course_id,
                      discord_channel_id: liveChannelId,
                      tutor_discord_user_id: tutorDiscordIdForFallback,
                      starts_at: classRow.starts_at,
                      ends_at: endsAt.toISOString(),
                    });
                  }
                }
              }
            }

            if (liveChannelId && channelFoundInDb && botUserId) {
              const tutorDiscordIdForUpdate = course.created_by
                ? tutorDiscordIdById.get(course.created_by) ?? ""
                : "";
              if (tutorDiscordIdForUpdate) {
                const enrolledDiscordIds = Array.from(
                  new Set(studentDiscordIdsByCourseId.get(classRow.course_id) ?? [])
                );
                const fullPermissionOverwrites = buildLiveVoicePermissionOverwrites({
                  guildId: discordGuildId,
                  botUserId,
                  ceoRoleId,
                  cooRoleId,
                  tutorDiscordUserId: tutorDiscordIdForUpdate,
                  studentDiscordUserIds: enrolledDiscordIds,
                });
                await updateDiscordChannel(liveChannelId, {
                  permission_overwrites: fullPermissionOverwrites,
                });
              }
            }

            if (liveChannelId) {
              voiceChannelLink = `https://discord.com/channels/${discordGuildId}/${liveChannelId}`;
            }
          }

          discordContent = voiceChannelLink;
        } else {
          // Legacy system
          const fiveMinBreakoutInstruction = breakoutRoomName
            ? `\nBreakout room: "${escapeDiscordText(breakoutRoomName)}"`
            : `\nPlease join the breakout room that starts with "${escapeDiscordText(
                `${tutorFirstName}${tutorLastInitial ? ` ${tutorLastInitial}` : ""}`
              )}" followed by the name of the course.`;
          const nonFounderFiveMinInstruction = [
            `Please join the meeting immediately:`,
            `Zoom ID: ${escapeDiscordText(defaultZoomId)}`,
            `Password: ${escapeDiscordText(defaultZoomPassword)}${fiveMinBreakoutInstruction}`,
            `**Please join the breakout room immediately after joining the meeting. Do not stay in the main meeting room.**`,
            `**Please use your registered student name to log into Zoom, otherwise you may be removed by the administrator and bear the consequences of not being able to attend the class.**`,
          ].join("\n");

          discordContent = [
            `Your class starts in **${escapeDiscordText(reminderLabel)}**.`,
            `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
            isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
            `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
            `**Start time (${torontoTimeZone}):** ${escapeDiscordText(
              formatTorontoDateTime(classRow.starts_at)
            )}`,
            isFounderTaughtClass
              ? "Please join the meeting on the Schoolhouse platform immediately!"
              : nonFounderFiveMinInstruction,
          ].join("\n");
        }
      }

      const tutorDiscordId = course.created_by
        ? tutorDiscordIdById.get(course.created_by) ?? ""
        : "";
      if (tutorDiscordId) {
        let contactInstruction = "";
        if (isFounderTaughtClass) {
          if (reminderType === "one_hour") {
            contactInstruction = "Please remember to mark the students' homework!";
          } else if (reminderType === "fifteen_minutes") {
            contactInstruction = "Please join the meeting via Schoolhouse!";
          }
        } else if (isTutorEarlyAccessReminder) {
          contactInstruction = voiceChannelLinkForTutor
            ? `Please join the voice channel now to prepare for your students: ${voiceChannelLinkForTutor}`
            : "Please prepare for your class starting in 15 minutes.";
        } else if (founderRoleId) {
          if (reminderType === "twenty_four_hours" || reminderType === "six_hours") {
            contactInstruction =
              `If you are unable to make it to the class, you have to contact a founder as soon as possible.`;
          } else if (reminderType === "one_hour") {
            contactInstruction =
              `If you are unable to make it to the class, contact a founder immediately.`;
          }
        }
        if (reminderType === "five_minutes") {
          contactInstruction = "Please join the meeting. You can start immediately at the start time and you do not have to wait for your students.";
        }

        executiveTutorContent = [
          `<@${tutorDiscordId}> Your **${escapeDiscordText(classTitleOrdinalRaw)}** for **${escapeDiscordText(courseTitleRaw)}** is starting in ${escapeDiscordText(reminderLabel)}.${contactInstruction ? ` ${contactInstruction}` : ""}`,
          !isFounderTaughtClass && !usesDiscordVoiceSystem ? "Please join the breakout room immediately after joining the meeting. Do not stay in the main meeting room." : "",
        ].filter(Boolean).join("\n");
      }

    const recipientList = Array.from(recipients).sort();
    const failedRecipients: { email: string; reason: string }[] = [];
    let successfulSends = 0;

    if (emailRemindersEnabled && recipientList.length > 0) {
      for (const recipient of recipientList) {
        try {
          await sendEmail(recipient, subject, html);
          successfulSends += 1;
          // Pace requests to reduce email provider throttling on bursts.
          await sleep(150);
        } catch (error) {
          failedRecipients.push({
            email: recipient,
            reason:
              error instanceof Error ? error.message : "Failed to send email.",
          });
        }
      }
    }

    if (failedRecipients.length > 0) {
      failedClasses.push({
        classId: classRow.id,
        reason: `Failed recipients: ${failedRecipients
          .map((item) => `${item.email} (${item.reason})`)
          .join("; ")}`,
      });
    }

    if (successfulSends > 0) {
      sentClassCount += 1;
      sentEmailCount += successfulSends;
      wasAnyReminderSent = true;
    }

    if (shouldSendCourseDiscordReminder) {
      if (!discordContent.trim()) {
        failedClasses.push({
          classId: classRow.id,
          reason: "Could not build Discord live voice channel link for reminder.",
        });
      } else {
      const discordTarget = discordCourseTargetByCourseId.get(classRow.course_id);
      if (!discordTarget) {
        failedClasses.push({
          classId: classRow.id,
          reason: `Missing Discord course channel or role mapping for course "${course.title}".`,
        });
      } else {
        try {
          const message = `<@&${discordTarget.roleId}>\n${discordContent}`;
          await sendDiscordCourseReminderMessage(
            discordTarget.channelId,
            discordTarget.roleId,
            message
          );
          sentDiscordReminderCount += 1;
          wasAnyReminderSent = true;
          await sleep(150);
        } catch (error) {
          failedClasses.push({
            classId: classRow.id,
            reason: `Failed Discord reminder send: ${error instanceof Error
              ? error.message
              : "Unknown Discord message send failure."
              }`,
          });
        }
      }
      }
    }

    // Send executive reminder to the executives channel with a tutor user mention.
    if (
      shouldSendExecutiveTutorReminder &&
      discordReminderDeliveryEnabled &&
      executivesChannelId &&
      executiveTutorContent
    ) {
      const tutorDiscordId = course.created_by
          ? tutorDiscordIdById.get(course.created_by) ?? ""
          : "";
        if (tutorDiscordId) {
          try {
            await sendDiscordUserMentionMessage(
              executivesChannelId,
              tutorDiscordId,
              executiveTutorContent
            );
            sentDiscordFollowUpCount += 1;
            wasAnyReminderSent = true;
            await sleep(150);
          } catch (error) {
            failedClasses.push({
              classId: classRow.id,
              reason: `Failed Discord executive reminder send: ${error instanceof Error
                ? error.message
                : "Unknown Discord executive reminder send failure."
                }`,
            });
          }
        }
    }

    if (
      shouldSendFounderChannelReminder &&
      foundersChannelId &&
      founderRoleId
    ) {
      let founderContent = "";

      const pingRoleId = cooRoleId || founderRoleId;

      if (reminderType === "ten_minutes") {
        founderContent = [
          `<@&${pingRoleId}> A class is starting in **10 minutes**. **Please open the Zoom meeting!**`,
          `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
          isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
          `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
          `**Start time (${torontoTimeZone}):** ${escapeDiscordText(formatTorontoDateTime(classRow.starts_at))}`,
        ].join("\n");
      } else {
        founderContent = [
          `<@&${pingRoleId}> A class is starting in **1 hour**.`,
          `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
          isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
          `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
          `**Start time (${torontoTimeZone}):** ${escapeDiscordText(formatTorontoDateTime(classRow.starts_at))}`,
        ].join("\n");
      }

      try {
        await sendDiscordCourseReminderMessage(
          foundersChannelId,
          founderRoleId,
          founderContent
        );
        sentDiscordFollowUpCount += 1;
        wasAnyReminderSent = true;
        await sleep(150);
      } catch (error) {
        failedClasses.push({
          classId: classRow.id,
          reason: `Failed Discord founder channel reminder send: ${error instanceof Error
            ? error.message
            : "Unknown Discord founder channel reminder send failure."
            }`,
        });
      }
    }
    if (wasAnyReminderSent) {
      await adminClient.from("class_reminder_logs").insert({
        class_id: classRow.id,
        reminder_type: reminderType,
      });
    }
  }

  let githubSync: GithubSyncResult | null = null;
  try {
    githubSync = await runGithubSync();
      
      // Update daily fundraising total
      const raised = await fetchFundraisingRaisedAmount();
      if (raised !== null) {
        const nowStr = new Date().toLocaleString("en-US", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const [month, day, year] = nowStr.split("/");
        const today = `${year}-${month}-${day}`;
        await adminClient.from("daily_donations").upsert({ date: today, amount: raised }, { onConflict: "date" });
      }

  } catch (error) {
    console.error("Failed to run Github sync from cron:", error);
    githubSync = {
      success: false,
      processed: 0,
      skippedReason: null,
      errors: [
        error instanceof Error
          ? error.message
          : "Unknown runtime exception in Github sync",
      ],
    };
  }

  return NextResponse.json({
    sentClassCount,
    sentEmailCount,
    sentDiscordReminderCount,
    sentDiscordFollowUpCount,
    autoClosedMeetingsCount: autoCloseResult.closedCount,
    autoCloseErrors: autoCloseResult.errors,
    failedClasses,
    liveChannelRecovery,
    attendanceRecorded,
    absenceFollowUps,
    timezone: torontoTimeZone,
    reminderSkippedReason,
    discordReminderSkippedReason,
    discordSync,
    githubSync,
  });
}

// I will patch the bottom of the file
