import { describe, expect, it } from "vitest";
import {
  breakoutRoomName,
  canOpenBreakoutRooms,
  clampBreakoutRoomCount,
  classCallChannelIds,
  isInClassCall,
  maxBreakoutRooms,
  nextBreakoutRoomNumbers,
  splitIntoBreakoutRooms,
} from "./breakoutRooms";

/** A deterministic stand-in for Math.random. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe("splitIntoBreakoutRooms", () => {
  const students = ["a", "b", "c", "d", "e", "f", "g"];

  it("keeps room sizes within one of each other", () => {
    const rooms = splitIntoBreakoutRooms(students, 3, seeded(7));
    const sizes = rooms.map((room) => room.length).sort();
    expect(sizes).toEqual([2, 2, 3]);
  });

  it("puts every student in exactly one room", () => {
    const rooms = splitIntoBreakoutRooms(students, 3, seeded(7));
    expect(rooms.flat().sort()).toEqual([...students].sort());
  });

  it("does not always put the same students together", () => {
    const first = splitIntoBreakoutRooms(students, 3, seeded(1));
    const second = splitIntoBreakoutRooms(students, 3, seeded(99));
    expect(first).not.toEqual(second);
  });

  it("leaves rooms empty rather than inventing people", () => {
    expect(splitIntoBreakoutRooms(["a"], 3, seeded(1)).map((room) => room.length).sort()).toEqual([0, 0, 1]);
  });

  it("has nothing to split into with no rooms", () => {
    expect(splitIntoBreakoutRooms(students, 0)).toEqual([]);
  });

  it("does not modify the list it was given", () => {
    const copy = [...students];
    splitIntoBreakoutRooms(students, 2, seeded(3));
    expect(students).toEqual(copy);
  });
});

describe("classCallChannelIds and isInClassCall", () => {
  const call = classCallChannelIds("live", ["room1", "room2"]);

  it("counts the class channel and every room as the class", () => {
    expect(isInClassCall("live", call)).toBe(true);
    expect(isInClassCall("room2", call)).toBe(true);
  });

  it("does not count another voice channel, or no channel", () => {
    expect(isInClassCall("someone-elses-class", call)).toBe(false);
    expect(isInClassCall(null, call)).toBe(false);
    expect(isInClassCall("", call)).toBe(false);
  });

  it("is just the class channel when no rooms are open", () => {
    expect([...classCallChannelIds("live")]).toEqual(["live"]);
  });

  it("ignores blank ids rather than letting an empty voice state match", () => {
    const ids = classCallChannelIds("", ["", "room1"]);
    expect([...ids]).toEqual(["room1"]);
    expect(isInClassCall("", ids)).toBe(false);
  });
});

describe("clampBreakoutRoomCount", () => {
  it("never goes past the maximum, counting rooms already open", () => {
    expect(clampBreakoutRoomCount(50)).toBe(maxBreakoutRooms);
    expect(clampBreakoutRoomCount(5, maxBreakoutRooms - 2)).toBe(2);
    expect(clampBreakoutRoomCount(1, maxBreakoutRooms)).toBe(0);
  });

  it("treats nonsense as zero", () => {
    expect(clampBreakoutRoomCount("three")).toBe(0);
    expect(clampBreakoutRoomCount(-4)).toBe(0);
  });
});

describe("nextBreakoutRoomNumbers", () => {
  it("fills the gaps a closed room left", () => {
    expect(nextBreakoutRoomNumbers([1, 3], 2)).toEqual([2, 4]);
  });

  it("starts at 1", () => {
    expect(nextBreakoutRoomNumbers([], 3)).toEqual([1, 2, 3]);
  });
});

describe("breakoutRoomName", () => {
  it("names the room after its number and course", () => {
    expect(breakoutRoomName(2, "Grade 6 French")).toBe("Room 2 · Grade 6 French");
  });

  it("stays within Discord's 100-character limit", () => {
    expect(Array.from(breakoutRoomName(1, "x".repeat(200))).length).toBe(100);
  });

  it("still has a name without a course title", () => {
    expect(breakoutRoomName(3, "  ")).toBe("Room 3");
  });
});

describe("canOpenBreakoutRooms", () => {
  const startsAtMs = Date.UTC(2026, 8, 26, 22, 0);

  it("opens once students are let into the class channel", () => {
    expect(canOpenBreakoutRooms({ nowMs: startsAtMs - 5 * 60 * 1000, startsAtMs, liveChannelOpen: true })).toBe(true);
  });

  it("stays shut during the tutor's early access, so rooms never copy tutor-only access", () => {
    expect(canOpenBreakoutRooms({ nowMs: startsAtMs - 10 * 60 * 1000, startsAtMs, liveChannelOpen: true })).toBe(false);
  });

  it("needs the class channel to exist", () => {
    expect(canOpenBreakoutRooms({ nowMs: startsAtMs + 60_000, startsAtMs, liveChannelOpen: false })).toBe(false);
  });
});
