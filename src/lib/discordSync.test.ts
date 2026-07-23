import { describe, expect, it } from "vitest";
import {
  areOverwritesEqual,
  buildUniqueCourseRoleName,
  getCourseEndedAtMs,
  getCourseTopicMarker,
  normalizeChannelName,
  normalizeRoleName,
  readCourseIdFromTopic,
} from "@/lib/discordSync";

describe("normalizeChannelName", () => {
  it("lowercases and dashes course titles", () => {
    expect(normalizeChannelName("Intro to Python", "course-1")).toBe(
      "intro-to-python"
    );
  });

  it("joins hyphenated words instead of splitting them", () => {
    expect(normalizeChannelName("Pre-Calculus", "course-1")).toBe("precalculus");
  });

  it("replaces punctuation with dashes and collapses runs", () => {
    expect(normalizeChannelName("Math!!  & Science", "course-1")).toBe(
      "math-science"
    );
  });

  it("falls back to a course-id-derived name for empty titles", () => {
    expect(normalizeChannelName("!!!", "AbC-123XYZ9876")).toBe(
      "course-abc123xyz9"
    );
  });

  it("caps the name at Discord's 100-character limit", () => {
    expect(normalizeChannelName("a".repeat(150), "course-1")).toHaveLength(100);
  });
});

describe("normalizeRoleName", () => {
  it("keeps the trimmed title", () => {
    expect(normalizeRoleName("  Intro to Python  ", "course-1")).toBe(
      "Intro to Python"
    );
  });

  it("falls back to a shortened course id for empty titles", () => {
    expect(normalizeRoleName("   ", "abcdefgh-rest")).toBe("Course abcdefgh");
  });
});

describe("buildUniqueCourseRoleName", () => {
  const role = (id: string, name: string, managed = false) => ({
    id,
    name,
    managed,
  });

  it("returns the base name when it is free", () => {
    expect(buildUniqueCourseRoleName("Python", "course-1", [])).toBe("Python");
  });

  it("appends a course-id suffix when the name is taken", () => {
    expect(
      buildUniqueCourseRoleName("Python", "AbC123", [role("1", "python")])
    ).toBe("Python (abc123)");
  });

  it("ignores the course's own existing role when checking conflicts", () => {
    expect(
      buildUniqueCourseRoleName("Python", "AbC123", [role("1", "Python")], "1")
    ).toBe("Python");
  });

  it("ignores managed (integration) roles when checking conflicts", () => {
    expect(
      buildUniqueCourseRoleName("Python", "AbC123", [role("1", "Python", true)])
    ).toBe("Python");
  });

  it("increments the suffix until a free name is found", () => {
    const roles = [role("1", "Python"), role("2", "Python (abc123)")];
    expect(buildUniqueCourseRoleName("Python", "AbC123", roles)).toBe(
      "Python (abc123-2)"
    );
  });
});

describe("course topic markers", () => {
  it("round-trips a course id", () => {
    const marker = getCourseTopicMarker("course-42");
    expect(readCourseIdFromTopic(marker)).toEqual({
      id: "course-42",
      flags: "",
    });
  });

  it("round-trips flags", () => {
    const marker = getCourseTopicMarker("course-42", "novoice");
    expect(readCourseIdFromTopic(marker)).toEqual({
      id: "course-42",
      flags: "novoice",
    });
  });

  it("returns empty values for non-marker topics", () => {
    expect(readCourseIdFromTopic("welcome to class")).toEqual({
      id: "",
      flags: "",
    });
    expect(readCourseIdFromTopic(null)).toEqual({ id: "", flags: "" });
  });
});

describe("getCourseEndedAtMs", () => {
  const baseCourse = {
    id: "c1",
    title: "Course",
    is_completed: false,
    created_by: null,
  };

  it("treats completed courses as ended immediately", () => {
    expect(getCourseEndedAtMs({ ...baseCourse, is_completed: true })).toBe(0);
  });

  it("treats courses without classes as never-ending", () => {
    expect(getCourseEndedAtMs({ ...baseCourse, course_classes: [] })).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it("returns the end of the latest class", () => {
    const ended = getCourseEndedAtMs({
      ...baseCourse,
      course_classes: [
        { starts_at: "2026-01-01T10:00:00Z", duration_hours: 1 },
        { starts_at: "2026-01-02T10:00:00Z", duration_hours: 2 },
      ],
    });
    expect(ended).toBe(new Date("2026-01-02T12:00:00Z").getTime());
  });

  it("defaults invalid durations to one hour", () => {
    const ended = getCourseEndedAtMs({
      ...baseCourse,
      course_classes: [{ starts_at: "2026-01-01T10:00:00Z", duration_hours: "not-a-number" }],
    });
    expect(ended).toBe(new Date("2026-01-01T11:00:00Z").getTime());
  });

  it("treats courses with only invalid class dates as never-ending", () => {
    const ended = getCourseEndedAtMs({
      ...baseCourse,
      course_classes: [{ starts_at: "garbage", duration_hours: 1 }],
    });
    expect(ended).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("areOverwritesEqual", () => {
  const overwrite = (id: string, allow: string, deny = "0") => ({
    id,
    type: 0 as const,
    allow,
    deny,
  });

  it("compares independently of order", () => {
    expect(
      areOverwritesEqual(
        [overwrite("a", "1024"), overwrite("b", "2048")],
        [overwrite("b", "2048"), overwrite("a", "1024")]
      )
    ).toBe(true);
  });

  it("detects differing permission bits", () => {
    expect(
      areOverwritesEqual([overwrite("a", "1024")], [overwrite("a", "3072")])
    ).toBe(false);
  });

  it("detects missing entries", () => {
    expect(
      areOverwritesEqual(
        [overwrite("a", "1024")],
        [overwrite("a", "1024"), overwrite("b", "2048")]
      )
    ).toBe(false);
  });

  it("treats undefined and empty as equal", () => {
    expect(areOverwritesEqual(undefined, [])).toBe(true);
  });
});
