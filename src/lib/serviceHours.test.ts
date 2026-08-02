import { describe, expect, it } from "vitest";
import {
  BASE_HOURS_PER_TEACHING_HOUR,
  SENIOR_HOURS_PER_TEACHING_HOUR,
  classCountForHours,
  describeHourSteps,
  normalizeGradeLevel,
  parseTeachingHours,
  serviceHourMultiplierForGrade,
  serviceHoursForClass,
  serviceHoursForClasses,
  sumHours,
  withdrawableHourSteps,
} from "@/lib/serviceHours";

describe("normalizeGradeLevel", () => {
  it("accepts numbers and numeric strings in range", () => {
    expect(normalizeGradeLevel(11)).toBe(11);
    expect(normalizeGradeLevel("12")).toBe(12);
    expect(normalizeGradeLevel(" 9 ")).toBe(9);
  });

  it("rejects blanks, out-of-range values, and junk", () => {
    expect(normalizeGradeLevel(null)).toBeNull();
    expect(normalizeGradeLevel(undefined)).toBeNull();
    expect(normalizeGradeLevel("")).toBeNull();
    expect(normalizeGradeLevel(0)).toBeNull();
    expect(normalizeGradeLevel(13)).toBeNull();
    expect(normalizeGradeLevel(11.5)).toBeNull();
    expect(normalizeGradeLevel("grade eleven")).toBeNull();
  });
});

describe("serviceHourMultiplierForGrade", () => {
  it("pays the senior rate for grades 11 and 12", () => {
    expect(serviceHourMultiplierForGrade(11)).toBe(SENIOR_HOURS_PER_TEACHING_HOUR);
    expect(serviceHourMultiplierForGrade("12")).toBe(SENIOR_HOURS_PER_TEACHING_HOUR);
  });

  it("pays the base rate for every other grade, and when unset or invalid", () => {
    expect(serviceHourMultiplierForGrade(9)).toBe(BASE_HOURS_PER_TEACHING_HOUR);
    expect(serviceHourMultiplierForGrade(10)).toBe(BASE_HOURS_PER_TEACHING_HOUR);
    expect(serviceHourMultiplierForGrade(null)).toBe(BASE_HOURS_PER_TEACHING_HOUR);
    expect(serviceHourMultiplierForGrade("")).toBe(BASE_HOURS_PER_TEACHING_HOUR);
    expect(serviceHourMultiplierForGrade(13)).toBe(BASE_HOURS_PER_TEACHING_HOUR);
  });
});

describe("parseTeachingHours", () => {
  it("reads numbers and numeric strings", () => {
    expect(parseTeachingHours(1.5)).toBe(1.5);
    expect(parseTeachingHours("2")).toBe(2);
  });

  it("falls back to one hour rather than zero for unusable values", () => {
    expect(parseTeachingHours(null)).toBe(1);
    expect(parseTeachingHours(undefined)).toBe(1);
    expect(parseTeachingHours("")).toBe(1);
    expect(parseTeachingHours("not-a-number")).toBe(1);
    expect(parseTeachingHours(0)).toBe(1);
    expect(parseTeachingHours(-2)).toBe(1);
  });
});

describe("serviceHoursForClass", () => {
  it("keeps the familiar value for a standard 60-minute class", () => {
    // The pre-August-2026 per-class rates, reproduced exactly.
    expect(serviceHoursForClass(1, null)).toBe(1.5);
    expect(serviceHoursForClass(1, 11)).toBe(2);
  });

  it("scales with teaching time", () => {
    expect(serviceHoursForClass(1.5, null)).toBe(2.25);
    expect(serviceHoursForClass(2, null)).toBe(3);
    expect(serviceHoursForClass(1.5, 12)).toBe(3);
    expect(serviceHoursForClass(0.5, null)).toBe(0.75);
  });

  it("treats an unusable duration as one hour", () => {
    expect(serviceHoursForClass(null, null)).toBe(1.5);
  });
});

describe("serviceHoursForClasses", () => {
  it("totals a whole course", () => {
    expect(
      serviceHoursForClasses(
        [{ durationHours: 1 }, { durationHours: 1 }, { durationHours: 1 }],
        null
      )
    ).toBe(4.5);
  });

  it("is unchanged when a class is dropped and another absorbs its time", () => {
    // The August 2026 policy: a missed class is deleted and a later one extended.
    const asScheduled = serviceHoursForClasses(
      [{ durationHours: 1 }, { durationHours: 1 }, { durationHours: 1 }, { durationHours: 1 }],
      null
    );
    const afterReshuffle = serviceHoursForClasses(
      [{ durationHours: 1 }, { durationHours: 1 }, { durationHours: 2 }],
      null
    );
    expect(afterReshuffle).toBe(asScheduled);
  });

  it("is unaffected by how the same total time is split", () => {
    const oneLongClass = serviceHoursForClasses([{ durationHours: 3 }], 11);
    const threeShortClasses = serviceHoursForClasses(
      [{ durationHours: 1 }, { durationHours: 1 }, { durationHours: 1 }],
      11
    );
    expect(oneLongClass).toBe(threeShortClasses);
  });

  it("totals nothing for a course with no classes", () => {
    expect(serviceHoursForClasses([], null)).toBe(0);
  });
});

describe("sumHours", () => {
  it("adds hours without floating-point noise", () => {
    expect(sumHours([1.5, 1.5, 2, 2])).toBe(7);
    expect(sumHours([])).toBe(0);
  });
});

describe("withdrawableHourSteps", () => {
  it("returns the running total for the oldest 1..n classes", () => {
    expect(withdrawableHourSteps([1.5, 2, 1.5])).toEqual([1.5, 3.5, 5]);
  });

  it("is empty when nothing is available", () => {
    expect(withdrawableHourSteps([])).toEqual([]);
  });
});

describe("classCountForHours", () => {
  it("maps an hour amount back to a whole number of classes", () => {
    const rates = [1.5, 2, 1.5, 2];
    expect(classCountForHours(rates, 1.5)).toBe(1);
    expect(classCountForHours(rates, 3.5)).toBe(2);
    expect(classCountForHours(rates, 5)).toBe(3);
    expect(classCountForHours(rates, 7)).toBe(4);
  });

  it("rejects amounts that do not land on a class boundary", () => {
    const rates = [2, 2, 1.5];
    expect(classCountForHours(rates, 1.5)).toBeNull();
    expect(classCountForHours(rates, 3)).toBeNull();
    expect(classCountForHours(rates, 6)).toBeNull();
    expect(classCountForHours(rates, 0)).toBeNull();
  });

  it("rejects anything beyond the available balance", () => {
    expect(classCountForHours([1.5, 1.5], 4.5)).toBeNull();
    expect(classCountForHours([], 1.5)).toBeNull();
  });
});

describe("describeHourSteps", () => {
  it("lists valid amounts and truncates long lists", () => {
    expect(describeHourSteps([1.5, 2])).toBe("1.5, 3.5");
    expect(describeHourSteps([1.5, 1.5, 1.5], 2)).toBe("1.5, 3, ...");
    expect(describeHourSteps([])).toBe("none");
  });
});
