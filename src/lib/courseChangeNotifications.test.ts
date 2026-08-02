import { describe, expect, it } from "vitest";
import {
  courseChangeDurationMinutes,
  formatCourseChangeDuration,
} from "@/lib/courseChangeNotifications";

describe("courseChangeDurationMinutes", () => {
  it("converts stored hours to whole minutes", () => {
    expect(courseChangeDurationMinutes(1)).toBe(60);
    expect(courseChangeDurationMinutes(1.5)).toBe(90);
    expect(courseChangeDurationMinutes(0.5)).toBe(30);
  });

  it("collapses the two representations of the same length", () => {
    // What the client sends (70/60) and what the numeric column stores.
    expect(courseChangeDurationMinutes(1.1666666666666667)).toBe(70);
    expect(courseChangeDurationMinutes(1.17)).toBe(70);
    expect(courseChangeDurationMinutes(1.1666666666666667)).toBe(
      courseChangeDurationMinutes(1.17)
    );
  });

  it("reads numeric strings from the database", () => {
    expect(courseChangeDurationMinutes("1.17")).toBe(70);
  });

  it("falls back to one hour for missing or unusable values", () => {
    expect(courseChangeDurationMinutes(null)).toBe(60);
    expect(courseChangeDurationMinutes(undefined)).toBe(60);
    expect(courseChangeDurationMinutes("")).toBe(60);
    expect(courseChangeDurationMinutes("not-a-number")).toBe(60);
    expect(courseChangeDurationMinutes(0)).toBe(60);
    expect(courseChangeDurationMinutes(-1)).toBe(60);
  });
});

describe("formatCourseChangeDuration", () => {
  it("renders minutes rather than fractional hours", () => {
    expect(formatCourseChangeDuration(1)).toBe("60 min");
    expect(formatCourseChangeDuration(1.1666666666666667)).toBe("70 min");
    expect(formatCourseChangeDuration(1.17)).toBe("70 min");
  });
});
