/**
 * Breakout rooms: extra voice channels a tutor opens during a class so the
 * students can work in small groups.
 *
 * The rules here are pure so they can be tested; the Discord and database work
 * is in breakoutRoomsServer.ts. The one rule that matters beyond this feature is
 * isInClassCall: a class is no longer one voice channel but the live channel
 * plus its rooms, and everything that asks "is this person in class?" —
 * attendance, tutor presence warnings, live-channel cleanup, YanLearn Recorder —
 * has to accept both. A tutor visiting a group is still teaching.
 */

/** More rooms than this is a lecture hall, not a class. */
export const maxBreakoutRooms = 10;
export const minBreakoutRooms = 1;

/**
 * Rooms can be opened once students are let into the class channel (5 minutes
 * before the start). Before that they would copy the tutor-only early access
 * and stay closed to the students for the rest of the class.
 */
export const breakoutRoomsOpenBeforeStartMs = 5 * 60 * 1000;

/** Discord caps channel names at 100 characters. */
export const breakoutRoomName = (number: number, courseTitle: string): string => {
  const title = String(courseTitle ?? "").trim().replace(/\s+/g, " ");
  const name = title ? `Room ${number} · ${title}` : `Room ${number}`;
  return Array.from(name).slice(0, 100).join("").trim();
};

/** Clamp a requested room count to what the class may have. */
export const clampBreakoutRoomCount = (requested: unknown, alreadyOpen = 0): number => {
  const value = Math.floor(Number(requested));
  if (!Number.isFinite(value)) {
    return 0;
  }
  const room = Math.max(0, maxBreakoutRooms - Math.max(0, alreadyOpen));
  return Math.max(0, Math.min(value, room));
};

/** The numbers new rooms get: the lowest ones not already in use. */
export const nextBreakoutRoomNumbers = (usedNumbers: number[], count: number): number[] => {
  const used = new Set(usedNumbers);
  const numbers: number[] = [];
  for (let candidate = 1; numbers.length < count; candidate += 1) {
    if (!used.has(candidate)) {
      numbers.push(candidate);
    }
  }
  return numbers;
};

/**
 * Deal people into rooms as evenly as possible — sizes differ by at most one —
 * in a random order, so the same students do not always end up together.
 * `random` is injectable for tests.
 */
export const splitIntoBreakoutRooms = <T>(
  people: T[],
  roomCount: number,
  random: () => number = Math.random
): T[][] => {
  const rooms = Math.max(0, Math.floor(roomCount));
  if (rooms === 0) {
    return [];
  }
  const shuffled = [...people];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const groups: T[][] = Array.from({ length: rooms }, () => []);
  shuffled.forEach((person, index) => {
    groups[index % rooms].push(person);
  });
  return groups;
};

/** Every voice channel that counts as this class's call. */
export const classCallChannelIds = (
  liveChannelId: string | null | undefined,
  breakoutChannelIds: Iterable<string> = []
): Set<string> => {
  const ids = new Set<string>();
  const live = String(liveChannelId ?? "").trim();
  if (live) {
    ids.add(live);
  }
  for (const id of breakoutChannelIds) {
    const value = String(id ?? "").trim();
    if (value) {
      ids.add(value);
    }
  }
  return ids;
};

/** Is someone whose voice state says `voiceChannelId` in the class? */
export const isInClassCall = (
  voiceChannelId: string | null | undefined,
  callChannelIds: Set<string>
): boolean => {
  const value = String(voiceChannelId ?? "").trim();
  return Boolean(value) && callChannelIds.has(value);
};

/** Whether rooms may be opened for a class right now. */
export const canOpenBreakoutRooms = ({
  nowMs,
  startsAtMs,
  liveChannelOpen,
}: {
  nowMs: number;
  startsAtMs: number;
  /** The class's live voice channel exists and has not been torn down. */
  liveChannelOpen: boolean;
}): boolean =>
  liveChannelOpen &&
  Number.isFinite(nowMs) &&
  Number.isFinite(startsAtMs) &&
  nowMs >= startsAtMs - breakoutRoomsOpenBeforeStartMs;
