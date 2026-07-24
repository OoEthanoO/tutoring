import { describe, expect, it } from "vitest";
import {
  floorToMinuteBoundary,
  formatOrdinalClass,
  getReminderWindow,
  reminderTargets,
} from "@/lib/reminderSchedule";

describe("formatOrdinalClass", () => {
  it("converts standard class titles to ordinals", () => {
    expect(formatOrdinalClass("Class 1")).toBe("1st class");
    expect(formatOrdinalClass("Class 2")).toBe("2nd class");
    expect(formatOrdinalClass("Class 3")).toBe("3rd class");
    expect(formatOrdinalClass("Class 4")).toBe("4th class");
  });

  it("handles the 11th/12th/13th exceptions", () => {
    expect(formatOrdinalClass("Class 11")).toBe("11th class");
    expect(formatOrdinalClass("Class 12")).toBe("12th class");
    expect(formatOrdinalClass("Class 13")).toBe("13th class");
    expect(formatOrdinalClass("Class 21")).toBe("21st class");
    expect(formatOrdinalClass("Class 111")).toBe("111th class");
  });

  it("leaves non-standard titles untouched", () => {
    expect(formatOrdinalClass("Final review")).toBe("Final review");
    expect(formatOrdinalClass("Class 3: Loops")).toBe("Class 3: Loops");
  });

  it("is case-insensitive on the Class prefix", () => {
    expect(formatOrdinalClass("class 2")).toBe("2nd class");
  });
});

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

  it("covers minutesBeforeStart plus the catch-up drift window", () => {
    const target = reminderTargets.find((item) => item.type === "five_minutes")!;
    const { windowStart, windowEnd } = getReminderWindow(base, target);
    // Drift of 2 minutes: a tick at 10:00 catches classes whose 5-minute
    // instant fell in the (possibly skipped) 09:58/09:59 ticks too.
    expect(windowStart.toISOString()).toBe("2026-01-01T10:03:00.000Z");
    expect(windowEnd.toISOString()).toBe("2026-01-01T10:06:00.000Z");
  });

  it("is drift + one minute wide for every target", () => {
    for (const target of reminderTargets) {
      const { windowStart, windowEnd } = getReminderWindow(base, target);
      expect(target.lowerBoundDriftMinutes).toBeGreaterThan(0);
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
