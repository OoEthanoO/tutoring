import { describe, expect, it } from "vitest";
import { MAX_COURSE_TITLE_LENGTH, MAX_NEW_COURSE_CLASSES, parseNewCourse } from "./newCourse";

/** What management's Create course form may send (api/admin/courses). */

const base = { title: "  Grade 10 Science ", ownerId: "owner" };
const at = (iso: string, durationHours = 1, tutorId?: string) => ({ startsAt: iso, durationHours, tutorId });

const parsed = (body: unknown) => {
  const result = parseNewCourse(body);
  if (!result.ok) throw new Error(`expected a course, got: ${result.error}`);
  return result.course;
};
const refused = (body: unknown) => {
  const result = parseNewCourse(body);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};

describe("parseNewCourse", () => {
  it("fills in a free course from the bare minimum", () => {
    expect(parsed(base)).toEqual({
      title: "Grade 10 Science",
      description: null,
      ownerId: "owner",
      coTutorId: null,
      isPaid: false,
      paidFee: null,
      donationFee: null,
      maxStudents: null,
      gradeLevel: null,
      recordingsEnabled: true,
      classes: [],
    });
  });

  it("keeps the details management typed", () => {
    const course = parsed({
      ...base, description: "Cells\r\nand atoms", coTutorId: "co", donationFee: 20, maxStudents: "12",
      gradeLevel: "10", recordingsEnabled: false,
    });
    expect(course).toMatchObject({
      description: "Cells\nand atoms", coTutorId: "co", donationFee: 20, maxStudents: 12, gradeLevel: 10,
      recordingsEnabled: false,
    });
  });

  it("needs a title and a tutor, and a co-tutor who is someone else", () => {
    expect(refused({ ...base, title: "   " })).toContain("title");
    expect(refused({ ...base, title: "x".repeat(MAX_COURSE_TITLE_LENGTH + 1) })).toContain("title");
    expect(refused({ title: "Course" })).toContain("tutor");
    expect(refused({ ...base, coTutorId: "owner" })).toContain("different tutor");
    expect(refused(null)).toContain("title");
  });

  it("takes a fee for a paid course and drops the donation", () => {
    expect(parsed({ ...base, isPaid: true, paidFee: "60", donationFee: 15 })).toMatchObject({
      isPaid: true, paidFee: 60, donationFee: null,
    });
    expect(refused({ ...base, isPaid: true })).toContain("course fee");
    expect(refused({ ...base, isPaid: true, paidFee: 0 })).toContain("course fee");
    expect(refused({ ...base, isPaid: true, paidFee: 6000 })).toContain("course fee");
    // Only an explicit true makes a course paid.
    expect(parsed({ ...base, isPaid: "true", paidFee: 60 })).toMatchObject({ isPaid: false, paidFee: null });
  });

  it("refuses donations, caps and grades outside their ranges", () => {
    expect(refused({ ...base, donationFee: -1 })).toContain("donation");
    expect(refused({ ...base, donationFee: 2.5 })).toContain("donation");
    expect(refused({ ...base, maxStudents: 0 })).toContain("Max students");
    expect(refused({ ...base, maxStudents: 101 })).toContain("Max students");
    expect(refused({ ...base, gradeLevel: 13 })).toContain("grade");
    expect(parsed({ ...base, maxStudents: "", gradeLevel: "" })).toMatchObject({ maxStudents: null, gradeLevel: null });
  });

  it("puts the classes in time order, taught by the tutor unless the co-tutor is named", () => {
    const course = parsed({
      ...base, coTutorId: "co",
      classes: [at("2026-12-03T23:00:00.000Z", 1.5, "co"), at("2026-12-01T23:00:00Z")],
    });
    expect(course.classes).toEqual([
      { startsAt: "2026-12-01T23:00:00.000Z", durationHours: 1, tutorId: "owner" },
      { startsAt: "2026-12-03T23:00:00.000Z", durationHours: 1.5, tutorId: "co" },
    ]);
  });

  it("refuses a class with no time, a silly length, a stranger teaching it or a twin", () => {
    expect(refused({ ...base, classes: [{ durationHours: 1 }] })).toContain("date and time");
    expect(refused({ ...base, classes: [at("not a date")] })).toContain("date and time");
    expect(refused({ ...base, classes: [at("2026-12-01T23:00:00Z", 0.1)] })).toContain("minutes");
    expect(refused({ ...base, classes: [at("2026-12-01T23:00:00Z", 7)] })).toContain("hours");
    expect(refused({ ...base, classes: [at("2026-12-01T23:00:00Z", 1, "stranger")] })).toContain("co-tutor");
    expect(refused({
      ...base, classes: [at("2026-12-01T23:00:00Z"), at("2026-12-01T18:00:00-05:00")],
    })).toContain("same time");
    const many = Array.from({ length: MAX_NEW_COURSE_CLASSES + 1 }, (_, index) =>
      at(new Date(Date.UTC(2027, 0, 1 + index, 23)).toISOString()));
    expect(refused({ ...base, classes: many })).toContain(`${MAX_NEW_COURSE_CLASSES} classes`);
  });
});
