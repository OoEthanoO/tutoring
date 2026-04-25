import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runDiscordSync, type DiscordSyncResult } from "@/lib/discordSync";
import { runGithubSync, type GithubSyncResult } from "@/lib/githubSync";
import { resolveRoleByEmail } from "@/lib/roles";

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
const defaultExecutivesChannelName = "executives";
const torontoTimeZone = "America/Toronto";
const defaultZoomId = "822 9677 5321";
const defaultZoomPassword = "youth";
type ReminderType =
  | "twenty_four_hours"
  | "six_hours"
  | "one_hour"
  | "fifteen_minutes"
  | "ten_minutes"
  | "five_minutes"
  | "class_follow_up";

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
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
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
  requestDiscord<{ id: string; name: string }[]>({
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
      archivedChannelCount: 0,
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

  const executivesChannelName =
    String(process.env.DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME ?? "").trim() ||
    defaultExecutivesChannelName;
  const foundersChannelName = "founders";
  let executivesChannelId: string | null = null;
  let foundersChannelId: string | null = null;
  let founderRoleId: string | null = null;

  if (!discordRemindersEnabled) {
    discordReminderSkippedReason =
      "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID.";
  } else {
    try {
      const guildChannels = await listDiscordGuildChannels(discordGuildId);
      const guildRoles = await listDiscordGuildRoles(discordGuildId);
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
    } catch (error) {
      discordReminderSkippedReason =
        error instanceof Error
          ? `Failed to load Discord channels: ${error.message}`
          : "Failed to load Discord channels.";
    }
  }

  const base = floorToMinuteBoundary(new Date());
  const candidates: CandidateReminder[] = [];

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
        "id, title, starts_at, duration_hours, course_id, course:courses(id, title, short_name, created_by, created_by_name, created_by_email)"
      )
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

  // Follow-ups
  const followUpWindowStart = new Date(base.getTime() - 2 * 60 * 1000);
  const followUpWindowEnd = new Date(base.getTime() + 1 * 60 * 1000);
  const searchStart = new Date(base.getTime() - 24 * 60 * 60 * 1000);

  const { data: pastClasses, error: pastClassError } = await adminClient
    .from("course_classes")
    .select(
      "id, title, starts_at, duration_hours, course_id, course:courses(id, title, short_name, created_by, created_by_name, created_by_email)"
    )
    .gte("starts_at", searchStart.toISOString())
    .lt("starts_at", followUpWindowEnd.toISOString());

  if (pastClassError) {
    return NextResponse.json(
      {
        error: pastClassError.message ?? "Failed to load classes for follow-up.",
        discordSync,
      },
      { status: 500 }
    );
  }

  for (const classRow of (pastClasses ?? []) as ClassRow[]) {
    const course = readCourse(classRow.course);
    if (course && !course.created_by_name && !course.created_by_email) {
      continue;
    }

    const startsAt = new Date(classRow.starts_at);
    const durationHours = typeof classRow.duration_hours === 'number'
      ? classRow.duration_hours
      : Number.parseFloat(String(classRow.duration_hours || 1));

    if (Number.isNaN(durationHours)) {
      continue;
    }

    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);

    if (endsAt >= followUpWindowStart && endsAt < followUpWindowEnd) {
      candidates.push({
        reminderType: "class_follow_up",
        reminderLabel: "0 minutes",
        classRow,
      });
    }
  }

  if (candidates.length === 0) {
    let githubSync: GithubSyncResult | null = null;
    try {
      githubSync = await runGithubSync();
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
      sentClassCount: 0,
      sentEmailCount: 0,
      sentDiscordReminderCount: 0,
      sentDiscordFollowUpCount: 0,
      failedClasses: [],
      timezone: torontoTimeZone,
      reminderSkippedReason,
      discordReminderSkippedReason,
      discordSync,
      githubSync,
    });
  }

  const courseIds = Array.from(
    new Set(candidates.map((item) => item.classRow.course_id))
  );
  const { data: enrollments, error: enrollmentError } = await adminClient
    .from("course_enrollments")
    .select("course_id, student_id, student_email")
    .in("course_id", courseIds);

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

  if (studentIds.size > 0) {
    const { data: studentRows } = await adminClient
      .from("app_users")
      .select("id, email")
      .in("id", Array.from(studentIds));
    const studentEmailById = new Map<string, string>();
    for (const student of studentRows ?? []) {
      const studentId = String(student.id ?? "").trim();
      const email = String(student.email ?? "").trim();
      if (studentId && email) {
        studentEmailById.set(studentId, email);
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
    }
  }

  const missingTutorIds = Array.from(
    new Set(
      candidates
        .map((item) => readCourse(item.classRow.course))
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
      candidates
        .map((item) => readCourse(item.classRow.course))
        .filter(Boolean)
        .filter((course) => course?.created_by)
        .map((course) => course!.created_by as string)
    )
  );
  const tutorDiscordIdById = new Map<string, string>();
  const tutorStrikeCountById = new Map<string, number>();
  if (allTutorIds.length > 0) {
    const { data: tutorDiscordRows } = await adminClient
      .from("app_users")
      .select("id, discord_user_id, strike_count")
      .in("id", allTutorIds);
    for (const tutor of tutorDiscordRows ?? []) {
      const discordId = String(tutor.discord_user_id ?? "").trim();
      if (discordId) {
        tutorDiscordIdById.set(tutor.id as string, discordId);
      }
      const strikeCount = Number(tutor.strike_count) || 0;
      if (strikeCount > 0) {
        tutorStrikeCountById.set(tutor.id as string, strikeCount);
      }
    }
  }

  let sentDiscordFollowUpCount = 0;

  let sentClassCount = 0;
  let sentEmailCount = 0;
  let sentDiscordReminderCount = 0;
  const failedClasses: { classId: string; reason: string }[] = [];
  const discordReminderDeliveryEnabled =
    discordRemindersEnabled && !discordReminderSkippedReason;

  for (const candidate of candidates) {
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
    const isFollowUpReminder = reminderType === "class_follow_up";
    const isCourseChannelReminder = reminderType === "one_hour" || reminderType === "five_minutes";

    const tutorEmail =
      String(course.created_by_email ?? "").trim() ||
      (course.created_by ? tutorEmailById.get(course.created_by) ?? "" : "");
    const isFounder = resolveRoleByEmail(tutorEmail) === "founder";

    const shouldSendCourseDiscordReminder =
      isCourseChannelReminder && discordReminderDeliveryEnabled;
    const shouldSendAnyEmail =
      (isStandardReminder || isFollowUpReminder) && emailRemindersEnabled;
    const shouldSendExecutiveTutorReminder =
      !isFollowUpReminder &&
      (isFounder
        ? reminderType !== "ten_minutes" && reminderType !== "five_minutes"
        : reminderType !== "ten_minutes" && reminderType !== "fifteen_minutes") &&
      discordReminderDeliveryEnabled &&
      executivesChannelId !== null;    const shouldSendFounderChannelReminder =
      !isFounder &&
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

    if (tutorEmail && (isStandardReminder || isFollowUpReminder)) {
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
    const classTitleOrdinal = escapeHtml(classTitleOrdinalRaw);
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

    if (reminderType === "class_follow_up") {
      subject = isFounder 
        ? `Class follow-up: Please submit manual activity for ${course.title}`
        : `Class follow-up: Please submit the tutor form for ${course.title}`;
      const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
      const formUrl = siteBase ? `${siteBase}/redirect/tutor-log` : "https://docs.google.com/forms/d/e/1FAIpQLSfbp8hNm_hpGUfH-SvGbnF7LbsiemBbeXhjddVccSHS8di2nw/viewform";
      html = `
        <p>Hi ${tutorName},</p>
        <p>Your <strong>${classTitleOrdinal}</strong> for <strong>${courseTitle}</strong> recently ended.</p>
        ${
          isFounder
            ? `<p>Please remember to submit a manual activity on the Schoolhouse platform.</p>`
            : `<p>Please remember to complete the tutor form:</p>\n        <p><a href="${formUrl}"><strong>${formUrl}</strong></a></p>`
        }
        <br/>
        <p><strong>Class details:</strong></p>
        <ul>
          <li><strong>Course:</strong> ${courseTitle}</li>
          <li><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></li>
          <li><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</li>
        </ul>
        <p>Thank you!</p>
      `;
      const tutorDiscordId = course.created_by
        ? tutorDiscordIdById.get(course.created_by) ?? ""
        : "";
      if (tutorDiscordId) {
        executiveTutorContent = [
          `<@${tutorDiscordId}> Your **${escapeDiscordText(classTitleOrdinalRaw)}** for **${escapeDiscordText(courseTitleRaw)}** recently ended.`,
          isFounder
            ? `Please remember to submit a manual activity on the Schoolhouse platform.`
            : `Please remember to complete the tutor log form:\n${formUrl}`,
          `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
          isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
          `**Start time (${torontoTimeZone}):** ${escapeDiscordText(
            formatTorontoDateTime(classRow.starts_at)
          )}`,
        ].join("\n");
      }
    } else {
      if (isStandardReminder) {
        subject = `Class reminder: starts in ${reminderLabel} (${course.title})`;
        html = `
        <p>Your class starts in <strong>${escapeHtml(reminderLabel)}</strong>.</p>
        <p><strong>Course:</strong> ${courseTitle}</p>
        <p><strong>${isStandardClassTitle ? classTitle : `Class: ${classTitle}`}</strong></p>
        <p><strong>Tutor:</strong> ${tutorName}</p>
        <p><strong>Start time (${torontoTimeZone}):</strong> ${startLabel}</p>
        ${
          isFounder
            ? `<p>Please attend the class 5 minutes before the start time on the Schoolhouse platform. If you don't have a Schoolhouse account yet, please create one using this link: <a href="https://schoolhouse.world/?ref=u-mx1o1c1hti">https://schoolhouse.world/?ref=u-mx1o1c1hti</a></p>`
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
          isFounder
            ? "Please attend the class 5 minutes before the start time on the Schoolhouse platform. If you don't have a Schoolhouse account yet, please create one using this link: https://schoolhouse.world/?ref=u-mx1o1c1hti"
            : nonFounderDiscordInstruction,
        ].join("\n");
      }

      if (reminderType === "five_minutes" && !isStandardReminder) {
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
          isFounder
            ? "Please join the meeting on the Schoolhouse platform immediately! If you don't have a Schoolhouse account yet, please create one using this link: https://schoolhouse.world/?ref=u-mx1o1c1hti"
            : nonFounderFiveMinInstruction,
        ].join("\n");
      }

      const tutorDiscordId = course.created_by
        ? tutorDiscordIdById.get(course.created_by) ?? ""
        : "";
      if (tutorDiscordId) {
        let contactInstruction = "";
        if (isFounder) {
          if (reminderType === "one_hour") {
            contactInstruction = "Please remember to mark the students' homework!";
          } else if (reminderType === "fifteen_minutes") {
            contactInstruction = "Please join the meeting via Schoolhouse!";
          }
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
          !isFounder ? "Please join the breakout room immediately after joining the meeting. Do not stay in the main meeting room." : "",
        ].filter(Boolean).join("\n");
      }
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
    }

    if (shouldSendCourseDiscordReminder) {
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

    // Send follow-up or executive reminder to the executives channel with a tutor user mention.
    if (
      (shouldSendExecutiveTutorReminder || isFollowUpReminder) &&
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

      if (reminderType === "ten_minutes") {
        founderContent = [
          `<@&${founderRoleId}> A class is starting in **10 minutes**. **Please open the Zoom meeting!**`,
          `**Course:** ${escapeDiscordText(courseTitleRaw)}`,
          isStandardClassTitle ? `**${escapeDiscordText(classTitleRaw)}**` : `**Class:** ${escapeDiscordText(classTitleRaw)}`,
          `**Tutor:** ${escapeDiscordText(tutorNameRaw)}`,
          `**Start time (${torontoTimeZone}):** ${escapeDiscordText(formatTorontoDateTime(classRow.starts_at))}`,
        ].join("\n");
      } else {
        founderContent = [
          `<@&${founderRoleId}> A class is starting in **1 hour**.`,
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
  }

  let githubSync: GithubSyncResult | null = null;
  try {
    githubSync = await runGithubSync();
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
    failedClasses,
    timezone: torontoTimeZone,
    reminderSkippedReason,
    discordReminderSkippedReason,
    discordSync,
    githubSync,
  });
}
