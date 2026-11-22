import { describe, expect, it } from "vitest";
import { courseTableStatus } from "./courseTable";

/** Explore → Courses table lists upcoming and ongoing courses, never finished ones. */

const now = Date.parse("2026-11-22T17:00:00.000Z");
const at = (iso: string, durationHours: unknown = 1) => ({ starts_at: iso, duration_hours: durationHours });

describe("courseTableStatus", () => {
  it("lists a course whose first class is still to come as upcoming", () => {
    expect(courseTableStatus({ course_classes: [at("2026-11-29T23:00:00Z"), at("2026-11-22T23:00:00Z")] }, now)).toBe("upcoming");
  });

  it("lists a course with no usable classes as upcoming", () => {
    expect(courseTableStatus({}, now)).toBe("upcoming");
    expect(courseTableStatus({ course_classes: [at("not a date")] }, now)).toBe("upcoming");
  });

  it("lists a started course with classes still to come as ongoing", () => {
    expect(courseTableStatus({ course_classes: [at("2026-11-15T23:00:00Z"), at("2026-11-29T23:00:00Z")] }, now)).toBe("ongoing");
  });

  it("counts a course whose last class is under way as ongoing until that class ends", () => {
    const course = { course_classes: [at("2026-11-01T16:00:00Z"), at("2026-11-22T16:30:00Z", 1)] };
    expect(courseTableStatus(course, now)).toBe("ongoing");
    expect(courseTableStatus(course, Date.parse("2026-11-22T17:30:00.000Z"))).toBeNull();
  });

  it("drops a course once every class has ended", () => {
    expect(courseTableStatus({ course_classes: [at("2026-11-01T23:00:00Z"), at("2026-11-15T23:00:00Z")] }, now)).toBeNull();
  });

  it("drops a course recorded as completed, whatever its classes say", () => {
    expect(courseTableStatus({ is_completed: true, course_classes: [at("2026-11-29T23:00:00Z")] }, now)).toBeNull();
    expect(courseTableStatus({ completed_start_date: "2025-01-05", completed_end_date: "2025-03-09" }, now)).toBeNull();
  });
});
