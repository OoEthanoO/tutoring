import { describe, expect, it } from "vitest";
import {
  BASE_HOURS_PER_CLASS,
  SENIOR_HOURS_PER_CLASS,
  classCountForHours,
  describeHourSteps,
  hoursPerClassForGrade,
  normalizeGradeLevel,
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

describe("hoursPerClassForGrade", () => {
  it("pays the senior rate for grades 11 and 12", () => {
    expect(hoursPerClassForGrade(11)).toBe(SENIOR_HOURS_PER_CLASS);
    expect(hoursPerClassForGrade("12")).toBe(SENIOR_HOURS_PER_CLASS);
  });

  it("pays the base rate for every other grade", () => {
    expect(hoursPerClassForGrade(9)).toBe(BASE_HOURS_PER_CLASS);
    expect(hoursPerClassForGrade(10)).toBe(BASE_HOURS_PER_CLASS);
  });

  it("falls back to the base rate when the grade is unset or invalid", () => {
    expect(hoursPerClassForGrade(null)).toBe(BASE_HOURS_PER_CLASS);
    expect(hoursPerClassForGrade("")).toBe(BASE_HOURS_PER_CLASS);
    expect(hoursPerClassForGrade(13)).toBe(BASE_HOURS_PER_CLASS);
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
