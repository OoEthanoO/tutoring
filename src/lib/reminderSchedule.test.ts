import { describe, expect, it } from "vitest";
import {
  floorToMinuteBoundary,
  getReminderWindow,
  reminderTargets,
} from "@/lib/reminderSchedule";

describe("floorToMinuteBoundary", () => {
  it("drops seconds and milliseconds", () => {
    const floored = floorToMinuteBoundary(new Date("2026-01-01T10:30:45.678Z"));
    expect(floored.toISOString()).toBe("2026-01-01T10:30:00.000Z");
  });

  it("leaves already-floored times unchanged", () => {
    const value = new Date("2026-01-01T10:30:00.000Z");
    expect(floorToMinuteBoundary(value).getTime()).toBe(value.getTime());
  });

  it("does not mutate its input", () => {
    const value = new Date("2026-01-01T10:30:45.000Z");
    floorToMinuteBoundary(value);
    expect(value.getSeconds()).toBe(45);
  });
});

describe("reminderTargets", () => {
  it("covers the six reminder stages in descending order", () => {
    expect(reminderTargets.map((target) => target.minutesBeforeStart)).toEqual([
      24 * 60,
      6 * 60,
      60,
      15,
      10,
      5,
    ]);
  });

  it("has unique types", () => {
    const types = reminderTargets.map((target) => target.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("getReminderWindow", () => {
  const base = new Date("2026-01-01T10:00:00.000Z");

  it("matches classes starting exactly minutesBeforeStart from now", () => {
    const target = reminderTargets.find((item) => item.type === "five_minutes")!;
    const { windowStart, windowEnd } = getReminderWindow(base, target);
    expect(windowStart.toISOString()).toBe("2026-01-01T10:05:00.000Z");
    expect(windowEnd.toISOString()).toBe("2026-01-01T10:06:00.000Z");
  });

  it("is exactly one minute wide when drift is zero", () => {
    for (const target of reminderTargets) {
      const { windowStart, windowEnd } = getReminderWindow(base, target);
      expect(windowEnd.getTime() - windowStart.getTime()).toBe(
        (target.lowerBoundDriftMinutes + 1) * 60 * 1000
      );
    }
  });

  it("extends the window backwards by the drift allowance", () => {
    const target = {
      type: "five_minutes" as const,
      minutesBeforeStart: 5,
      label: "5 minutes",
      lowerBoundDriftMinutes: 2,
    };
    const { windowStart, windowEnd } = getReminderWindow(base, target);
    expect(windowStart.toISOString()).toBe("2026-01-01T10:03:00.000Z");
    expect(windowEnd.toISOString()).toBe("2026-01-01T10:06:00.000Z");
  });
});
