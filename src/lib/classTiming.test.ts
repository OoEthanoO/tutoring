import { describe, expect, it } from "vitest";
import { classDurationMinutes, classEndDate, classEndMs } from "./classTiming";

// What the numeric(4,2) column does to a duration the client sends as minutes/60.
const stored = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

describe("classDurationMinutes", () => {
  it("recovers the entered minutes after the numeric(4,2) round trip", () => {
    for (let minutes = 1; minutes <= 480; minutes += 1) {
      expect(classDurationMinutes(stored(minutes))).toBe(minutes);
    }
  });

  it("accepts the unrounded value the client sends", () => {
    expect(classDurationMinutes(80 / 60)).toBe(80);
    expect(classDurationMinutes(1.5)).toBe(90);
  });

  it("parses string durations", () => {
    expect(classDurationMinutes("1.33")).toBe(80);
  });

  it("falls back to one hour for missing or unusable durations", () => {
    expect(classDurationMinutes(null)).toBe(60);
    expect(classDurationMinutes(undefined)).toBe(60);
    expect(classDurationMinutes(0)).toBe(60);
    expect(classDurationMinutes(-1)).toBe(60);
    expect(classDurationMinutes("abc")).toBe(60);
  });
});

describe("classEndMs", () => {
  it("ends an 80-minute class 80 minutes after it starts", () => {
    const start = new Date("2026-08-16T19:00:00").getTime();
    // 1.33 is what a class created as 80 minutes reads back as.
    expect(classEndMs(start, 1.33)).toBe(new Date("2026-08-16T20:20:00").getTime());
  });

  it("lands on a whole minute for every duration", () => {
    const start = new Date("2026-08-16T19:00:00").getTime();
    for (let minutes = 1; minutes <= 480; minutes += 1) {
      expect(classEndMs(start, stored(minutes)) % 60000).toBe(start % 60000);
    }
  });
});

describe("classEndDate", () => {
  it("matches classEndMs", () => {
    const start = new Date("2026-08-16T19:00:00");
    expect(classEndDate(start, 1.33).getTime()).toBe(classEndMs(start.getTime(), 1.33));
  });
});
