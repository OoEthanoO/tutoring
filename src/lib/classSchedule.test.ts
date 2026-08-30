import { describe, expect, it } from "vitest";
import { addLocalDaysAndMinutes, suggestNextClassStart } from "./classSchedule";

// Local wall clock, so the assertions describe what a tutor sees in the
// date/time input rather than a UTC instant.
const local = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
) => new Date(year, month - 1, day, hours, minutes, 0, 0);

const wallClock = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")} ${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes()
  ).padStart(2, "0")}`;

describe("suggestNextClassStart", () => {
  it("returns null with no classes to extrapolate from", () => {
    expect(suggestNextClassStart([])).toBeNull();
  });

  it("suggests the same time a week later for a single class", () => {
    const suggested = suggestNextClassStart([local(2026, 5, 7, 20, 0)]);
    expect(wallClock(suggested!)).toBe("2026-05-14 20:00");
  });

  it("repeats the gap between the two latest classes", () => {
    const suggested = suggestNextClassStart([
      local(2026, 5, 5, 20, 0),
      local(2026, 5, 7, 18, 30),
    ]);
    expect(wallClock(suggested!)).toBe("2026-05-09 17:00");
  });

  it("ignores classes that are not the two latest, whatever order they arrive in", () => {
    const suggested = suggestNextClassStart([
      local(2026, 5, 14, 20, 0),
      local(2026, 5, 1, 9, 0),
      local(2026, 5, 7, 20, 0),
    ]);
    expect(wallClock(suggested!)).toBe("2026-05-21 20:00");
  });

  // In zones that observe DST these weeks are 167 and 169 hours long, so the
  // suggestion drifts to 7:00 PM / 9:00 PM if the gap is applied as raw
  // milliseconds. In zones without DST the assertions hold trivially.
  it("keeps the wall-clock time across a spring-forward boundary", () => {
    const suggested = suggestNextClassStart([
      local(2026, 3, 1, 20, 0),
      local(2026, 3, 8, 20, 0),
    ]);
    expect(wallClock(suggested!)).toBe("2026-03-15 20:00");
  });

  it("keeps the wall-clock time across a fall-back boundary", () => {
    const suggested = suggestNextClassStart([
      local(2026, 10, 25, 20, 0),
      local(2026, 11, 1, 20, 0),
    ]);
    expect(wallClock(suggested!)).toBe("2026-11-08 20:00");
  });

  it("keeps the wall-clock time when the single-class fallback crosses a boundary", () => {
    const suggested = suggestNextClassStart([local(2026, 11, 1, 20, 0)]);
    expect(wallClock(suggested!)).toBe("2026-11-08 20:00");
  });
});

describe("addLocalDaysAndMinutes", () => {
  it("adds days and minutes in wall-clock terms", () => {
    const result = addLocalDaysAndMinutes(local(2026, 3, 6, 20, 0), 9, 45);
    expect(wallClock(result)).toBe("2026-03-15 20:45");
  });

  it("normalizes a minute overflow into the next day", () => {
    const result = addLocalDaysAndMinutes(local(2026, 5, 7, 23, 30), 0, 45);
    expect(wallClock(result)).toBe("2026-05-08 00:15");
  });
});
