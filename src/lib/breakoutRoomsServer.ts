import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient, type SessionUser } from "@/lib/authServer";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import {
  breakoutRoomName,
  canOpenBreakoutRooms,
  clampBreakoutRoomCount,
  classCallChannelIds,
  maxBreakoutRooms,
  nextBreakoutRoomNumbers,
  splitIntoBreakoutRooms,
} from "@/lib/breakoutRooms";

/**
 * Breakout rooms against Discord and the database. The rules are in
 * breakoutRooms.ts; this is the plumbing — who may run a class's rooms, and
 * opening, splitting students into, and closing them.
 */

const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";
const discordApiBase = "https://discord.com/api/v10";
const discordVoiceChannelType = 2;

export class BreakoutError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type DiscordOverwrite = { id: string; type: number; allow: string; deny: string };
type DiscordChannel = {
  id: string;
  parent_id?: string | null;
  position?: number;
  permission_overwrites?: DiscordOverwrite[];
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A Discord REST call, retried on rate limits. Errors carry Discord's message. */
const discord = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  if (!discordBotToken || !discordGuildId) {
    throw new BreakoutError("Discord is not configured on the server.", 503);
  }
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${discordApiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${discordBotToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-Audit-Log-Reason": "YanLearn breakout rooms",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await response.text().catch(() => "");
    let payload: Record<string, unknown> | null = null;
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(payload?.retry_after);
      await sleep(Number.isFinite(retryAfter) ? Math.ceil(retryAfter * 1000) + 50 : 500 * attempt);
      continue;
    }
    if (!response.ok) {
      const message = String(payload?.message ?? "").trim() || `Discord API error (${response.status}).`;
      throw new Error(message);
    }
    return (payload ?? undefined) as T;
  }
};

/** The voice channel a member is in, or null. Throws when Discord cannot say. */
const voiceChannelOf = async (discordUserId: string): Promise<string | null> => {
  try {
    const state = await discord<{ channel_id?: string | null }>(
      "GET",
      `/guilds/${discordGuildId}/voice-states/${discordUserId}`
    );
    return String(state?.channel_id ?? "").trim() || null;
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unknown voice state")) {
      return null;
    }
    throw error;
  }
};

/** Move someone already in voice to another channel. */
const moveToChannel = (discordUserId: string, channelId: string) =>
  discord("PATCH", `/guilds/${discordGuildId}/members/${discordUserId}`, { channel_id: channelId });

const deleteChannel = async (channelId: string) => {
  try {
    await discord("DELETE", `/channels/${channelId}`);
  } catch (error) {
    // Already gone is what we wanted.
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("unknown channel")) {
      throw error;
    }
  }
};

/** Discord's refusal to move people, said in a way a tutor can act on. */
const explainMoveFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  if (message.toLowerCase().includes("missing permissions")) {
    return "YanBot is not allowed to move people between voice channels. Give its role \"Move Members\" in Discord.";
  }
  return message;
};

// --- Open rooms, per class -------------------------------------------------------

type BreakoutRoomRow = { id: string; number: number; discord_channel_id: string; live_channel_id: string };

/**
 * The open rooms for each class, as Discord channel ids. Used by everything
 * that asks whether someone is in a class: see classCallChannelIds.
 */
export const loadBreakoutChannelIdsByClassId = async (
  adminClient: SupabaseClient,
  classIds: string[]
): Promise<Map<string, string[]>> => {
  const byClass = new Map<string, string[]>();
  if (classIds.length === 0) {
    return byClass;
  }
  const { data, error } = await adminClient
    .from("discord_breakout_rooms")
    .select("class_id, discord_channel_id")
    .in("class_id", classIds)
    .is("deleted_at", null);
  if (error) {
    // Treat as "no rooms": counting someone in a room as absent is recoverable
    // on the next tick; failing the whole caller is not.
    return byClass;
  }
  for (const row of data ?? []) {
    const classId = String(row.class_id);
    byClass.set(classId, [...(byClass.get(classId) ?? []), String(row.discord_channel_id)]);
  }
  return byClass;
};

/**
 * Delete every open room of a class, e.g. because its live channel was just
 * deleted. Anyone still in one is disconnected by Discord. Returns error
 * messages rather than throwing so a cron tick carries on.
 */
export const deleteBreakoutRoomsForClass = async (
  adminClient: SupabaseClient,
  classId: string
): Promise<string[]> => {
  const errors: string[] = [];
  const { data } = await adminClient
    .from("discord_breakout_rooms")
    .select("id, discord_channel_id")
    .eq("class_id", classId)
    .is("deleted_at", null);
  for (const room of data ?? []) {
    try {
      await deleteChannel(String(room.discord_channel_id));
      await adminClient
        .from("discord_breakout_rooms")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", String(room.id));
    } catch (error) {
      errors.push(`Failed to delete a breakout room: ${error instanceof Error ? error.message : "Unknown error."}`);
    }
  }
  return errors;
};

/**
 * Rooms whose class channel is gone. They sit in the Live category, which the
 * Discord sync never sweeps, so without this they would stay forever.
 */
export const sweepOrphanBreakoutRooms = async (adminClient: SupabaseClient): Promise<string[]> => {
  const { data: rooms } = await adminClient
    .from("discord_breakout_rooms")
    .select("class_id")
    .is("deleted_at", null);
  const classIds = [...new Set((rooms ?? []).map((room) => String(room.class_id)))];
  if (classIds.length === 0) {
    return [];
  }
  const { data: liveRows } = await adminClient
    .from("discord_live_class_channels")
    .select("class_id")
    .in("class_id", classIds)
    .is("deleted_at", null);
  const stillLive = new Set((liveRows ?? []).map((row) => String(row.class_id)));
  const errors: string[] = [];
  for (const classId of classIds) {
    if (!stillLive.has(classId)) {
      errors.push(...(await deleteBreakoutRoomsForClass(adminClient, classId)));
    }
  }
  return errors;
};

// --- Access ------------------------------------------------------------------------

type ClassRow = {
  id: string;
  title: string | null;
  starts_at: string;
  course: {
    id: string;
    title: string | null;
    created_by: string | null;
    co_tutor_id: string | null;
    deleted_at: string | null;
  };
};

export type BreakoutAccess = {
  db: SupabaseClient;
  user: SessionUser;
  lesson: ClassRow;
  liveChannelId: string | null;
};

/** The same people who run a class's exercises: its tutors and the trio. */
const canRunClass = (user: SessionUser, course: ClassRow["course"]) =>
  isFounder(resolveAccountRole(user)) ||
  course.created_by === user.id ||
  course.co_tutor_id === user.id;

export const getBreakoutAccess = async (
  user: SessionUser | null,
  classId: string
): Promise<BreakoutAccess> => {
  if (!user) {
    throw new BreakoutError("Sign in to YanLearn to manage breakout rooms.", 401);
  }
  if (!/^[0-9a-f-]{36}$/i.test(classId)) {
    throw new BreakoutError("Class not found.", 404);
  }
  const db = getAdminClient();
  const { data, error } = await db
    .from("course_classes")
    .select("id, title, starts_at, course:courses!inner(id, title, created_by, co_tutor_id, deleted_at)")
    .eq("id", classId)
    .maybeSingle();
  if (error) {
    throw new BreakoutError("Could not load the class.", 500);
  }
  const lesson = data as unknown as ClassRow | null;
  if (!lesson || lesson.course.deleted_at) {
    throw new BreakoutError("Class not found.", 404);
  }
  if (!canRunClass(user, lesson.course)) {
    throw new BreakoutError("Only this course's tutors and YanLearn management can run its breakout rooms.", 403);
  }
  const { data: liveRow } = await db
    .from("discord_live_class_channels")
    .select("discord_channel_id, deleted_at")
    .eq("class_id", classId)
    .maybeSingle();
  const liveChannelId =
    liveRow && !liveRow.deleted_at ? String(liveRow.discord_channel_id ?? "").trim() || null : null;
  return { db, user, lesson, liveChannelId };
};

// --- Who is where ------------------------------------------------------------------

type Participant = { userId: string; name: string; discordIds: string[] };

/** Enrolled students with a linked Discord account. */
const classStudents = async (access: BreakoutAccess): Promise<Participant[]> => {
  const { data } = await access.db
    .from("course_enrollments")
    .select("student_id, student:app_users!student_id(full_name, email, discord_user_id)")
    .eq("course_id", access.lesson.course.id);
  const students: Participant[] = [];
  for (const row of data ?? []) {
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) as
      | { full_name: string | null; email: string | null; discord_user_id: string | null }
      | null;
    const discordId = String(student?.discord_user_id ?? "").trim();
    const userId = String(row.student_id);
    // A tutor enrolled in their own course is not a student to move around.
    if (!discordId || userId === access.lesson.course.created_by || userId === access.lesson.course.co_tutor_id) {
      continue;
    }
    students.push({
      userId,
      name: String(student?.full_name ?? "").trim() || String(student?.email ?? "Student"),
      discordIds: [discordId],
    });
  }
  return students;
};

/** The course's tutors, with their approved extra accounts. */
const classTutors = async (access: BreakoutAccess): Promise<Participant[]> => {
  const ids = [access.lesson.course.created_by, access.lesson.course.co_tutor_id].filter(
    (id): id is string => Boolean(id)
  );
  if (ids.length === 0) {
    return [];
  }
  const [{ data: users }, { data: extras }] = await Promise.all([
    access.db.from("app_users").select("id, full_name, discord_user_id").in("id", ids),
    access.db.from("approved_discord_accounts").select("owner_user_id, discord_user_id").in("owner_user_id", ids),
  ]);
  return (users ?? []).map((user) => ({
    userId: String(user.id),
    name: String(user.full_name ?? "Tutor"),
    discordIds: [
      String(user.discord_user_id ?? "").trim(),
      ...(extras ?? [])
        .filter((extra) => String(extra.owner_user_id) === String(user.id))
        .map((extra) => String(extra.discord_user_id ?? "").trim()),
    ].filter(Boolean),
  }));
};

const openRooms = async (access: BreakoutAccess): Promise<BreakoutRoomRow[]> => {
  const { data, error } = await access.db
    .from("discord_breakout_rooms")
    .select("id, number, discord_channel_id, live_channel_id")
    .eq("class_id", access.lesson.id)
    .is("deleted_at", null)
    .order("number");
  if (error) {
    throw new BreakoutError("Could not load the breakout rooms.", 500);
  }
  return (data ?? []) as BreakoutRoomRow[];
};

/** Where one person is: the voice channel of the first of their accounts in one. */
const locate = async (person: Participant): Promise<{ channelId: string | null; known: boolean; discordId: string | null }> => {
  let known = true;
  for (const discordId of person.discordIds) {
    try {
      const channelId = await voiceChannelOf(discordId);
      if (channelId) {
        return { channelId, known: true, discordId };
      }
    } catch {
      known = false;
    }
  }
  return { channelId: null, known, discordId: null };
};

export type BreakoutState = {
  classId: string;
  /** Rooms can be opened now: the class channel exists and students are in. */
  canOpen: boolean;
  liveChannelUrl: string | null;
  maxRooms: number;
  rooms: { id: string; number: number; url: string; students: string[] }[];
  /** Students in the class channel itself, not in a room. */
  inMainRoom: string[];
  /** Enrolled students with Discord who are not in the class at all. */
  notInCall: string[];
  /** Students whose whereabouts Discord would not report. */
  unknown: string[];
  /** Enrolled students who never linked Discord, so cannot be placed. */
  withoutDiscord: number;
};

const channelUrl = (channelId: string) => `https://discord.com/channels/${discordGuildId}/${channelId}`;

export const readBreakoutState = async (access: BreakoutAccess): Promise<BreakoutState> => {
  const rooms = await openRooms(access);
  const { count: enrolledCount } = await access.db
    .from("course_enrollments")
    .select("student_id", { count: "exact", head: true })
    .eq("course_id", access.lesson.course.id);
  const students = await classStudents(access);
  const roomByChannelId = new Map(rooms.map((room) => [room.discord_channel_id, room]));
  const state: BreakoutState = {
    classId: access.lesson.id,
    canOpen: canOpenBreakoutRooms({
      nowMs: Date.now(),
      startsAtMs: Date.parse(access.lesson.starts_at),
      liveChannelOpen: Boolean(access.liveChannelId),
    }),
    liveChannelUrl: access.liveChannelId ? channelUrl(access.liveChannelId) : null,
    maxRooms: maxBreakoutRooms,
    rooms: rooms.map((room) => ({
      id: room.id,
      number: room.number,
      url: channelUrl(room.discord_channel_id),
      students: [],
    })),
    inMainRoom: [],
    notInCall: [],
    unknown: [],
    withoutDiscord: Math.max(0, (enrolledCount ?? 0) - students.length),
  };
  // Only worth asking Discord while the class is running.
  if (!access.liveChannelId) {
    return state;
  }
  for (const student of students) {
    const where = await locate(student);
    if (!where.known) {
      state.unknown.push(student.name);
    } else if (where.channelId === access.liveChannelId) {
      state.inMainRoom.push(student.name);
    } else if (where.channelId && roomByChannelId.has(where.channelId)) {
      const number = roomByChannelId.get(where.channelId)?.number;
      state.rooms.find((room) => room.number === number)?.students.push(student.name);
    } else {
      state.notInCall.push(student.name);
    }
  }
  return state;
};

// --- Actions -----------------------------------------------------------------------

/** Students in the class right now — the class channel or any room — with the account they are on. */
const studentsInCall = async (access: BreakoutAccess, callIds: Set<string>) => {
  const inCall: { name: string; discordId: string }[] = [];
  for (const student of await classStudents(access)) {
    const where = await locate(student);
    if (where.channelId && where.discordId && callIds.has(where.channelId)) {
      inCall.push({ name: student.name, discordId: where.discordId });
    }
  }
  return inCall;
};

/** Deal the students in the class into the open rooms, evenly and at random. */
const splitStudents = async (access: BreakoutAccess, rooms: BreakoutRoomRow[]): Promise<string[]> => {
  if (rooms.length === 0 || !access.liveChannelId) {
    return [];
  }
  const callIds = classCallChannelIds(access.liveChannelId, rooms.map((room) => room.discord_channel_id));
  const groups = splitIntoBreakoutRooms(await studentsInCall(access, callIds), rooms.length);
  const problems: string[] = [];
  for (const [index, group] of groups.entries()) {
    for (const student of group) {
      try {
        await moveToChannel(student.discordId, rooms[index].discord_channel_id);
      } catch (error) {
        problems.push(`${student.name}: ${explainMoveFailure(error)}`);
      }
    }
  }
  return problems;
};

export type BreakoutAction =
  | { action: "open"; count: number; split: boolean }
  | { action: "split" }
  | { action: "close" };

export const readBreakoutAction = (body: unknown): BreakoutAction => {
  const value = (body ?? {}) as Record<string, unknown>;
  if (value.action === "open") {
    return { action: "open", count: Number(value.count), split: value.split !== false };
  }
  if (value.action === "split" || value.action === "close") {
    return { action: value.action };
  }
  throw new BreakoutError("Unknown breakout room action.");
};

/**
 * Carry out an action. Returns problems that did not stop it — typically a
 * student Discord would not move — so the tutor sees them without the whole
 * action failing.
 */
export const runBreakoutAction = async (
  access: BreakoutAccess,
  request: BreakoutAction
): Promise<string[]> => {
  if (!access.liveChannelId) {
    throw new BreakoutError("This class's voice channel is not open, so there is nothing to break out of.", 409);
  }

  if (request.action === "open") {
    if (!canOpenBreakoutRooms({
      nowMs: Date.now(),
      startsAtMs: Date.parse(access.lesson.starts_at),
      liveChannelOpen: true,
    })) {
      throw new BreakoutError("Breakout rooms open once students are let into the class, 5 minutes before it starts.", 409);
    }
    const existing = await openRooms(access);
    const count = clampBreakoutRoomCount(request.count, existing.length);
    if (count === 0) {
      throw new BreakoutError(`A class can have at most ${maxBreakoutRooms} breakout rooms.`);
    }
    // Rooms copy the class channel's current access and sit right after it.
    const live = await discord<DiscordChannel>("GET", `/channels/${access.liveChannelId}`);
    const created: BreakoutRoomRow[] = [];
    for (const number of nextBreakoutRoomNumbers(existing.map((room) => room.number), count)) {
      const channel = await discord<DiscordChannel>("POST", `/guilds/${discordGuildId}/channels`, {
        name: breakoutRoomName(number, access.lesson.course.title ?? ""),
        type: discordVoiceChannelType,
        parent_id: live.parent_id ?? null,
        permission_overwrites: live.permission_overwrites ?? [],
      });
      const { data: row, error } = await access.db
        .from("discord_breakout_rooms")
        .insert({
          class_id: access.lesson.id,
          live_channel_id: access.liveChannelId,
          discord_channel_id: channel.id,
          number,
          created_by: access.user.id,
        })
        .select("id, number, discord_channel_id, live_channel_id")
        .single();
      if (error || !row) {
        // Never leave a channel nothing tracks: it would sit in Live forever.
        await deleteChannel(channel.id).catch(() => undefined);
        throw new BreakoutError("Could not save the breakout room.", 500);
      }
      created.push(row as BreakoutRoomRow);
    }
    return request.split ? splitStudents(access, [...existing, ...created].sort((a, b) => a.number - b.number)) : [];
  }

  if (request.action === "split") {
    const rooms = await openRooms(access);
    if (rooms.length === 0) {
      throw new BreakoutError("Open some breakout rooms first.", 409);
    }
    return splitStudents(access, rooms);
  }

  // Close: bring everyone back to the class channel, then delete the rooms.
  const rooms = await openRooms(access);
  if (rooms.length === 0) {
    return [];
  }
  const roomIds = new Set(rooms.map((room) => room.discord_channel_id));
  const problems: string[] = [];
  for (const person of [...(await classStudents(access)), ...(await classTutors(access))]) {
    const where = await locate(person);
    if (where.channelId && where.discordId && roomIds.has(where.channelId)) {
      try {
        await moveToChannel(where.discordId, access.liveChannelId);
      } catch (error) {
        problems.push(`${person.name}: ${explainMoveFailure(error)}`);
      }
    }
  }
  for (const room of rooms) {
    try {
      await deleteChannel(room.discord_channel_id);
      await access.db
        .from("discord_breakout_rooms")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", room.id);
    } catch (error) {
      problems.push(`Room ${room.number}: ${error instanceof Error ? error.message : "could not be deleted."}`);
    }
  }
  return problems;
};
