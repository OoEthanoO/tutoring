import { describe, expect, it } from "vitest";
import { executiveStanding, teachesCourseIds } from "./executiveStanding";

describe("executiveStanding", () => {
  it("makes an executive with a course a plain Executive", () => {
    expect(executiveStanding({ role: "Executive", teachesCourse: true })).toBe("executive");
  });

  it("makes an executive with no course Pending", () => {
    expect(executiveStanding({ role: "Executive", teachesCourse: false })).toBe("pending");
  });

  it("keeps an exempt executive out of Pending", () => {
    expect(executiveStanding({ role: "Executive", teachesCourse: false, exempt: true })).toBe(
      "executive"
    );
  });

  it("treats the lowercase role the same", () => {
    expect(executiveStanding({ role: "executive", teachesCourse: false })).toBe("pending");
  });

  it("never puts the founder trio in Pending", () => {
    for (const role of ["founder", "CEO", "COO"] as const) {
      expect(executiveStanding({ role, teachesCourse: false })).toBeNull();
    }
  });

  it("leaves Chief Executives and students to their own roles", () => {
    expect(executiveStanding({ role: "Chief Executive", teachesCourse: false })).toBeNull();
    expect(executiveStanding({ role: "student", teachesCourse: false })).toBeNull();
    expect(executiveStanding({ role: null, teachesCourse: false })).toBeNull();
  });

  it("returns one standing, so the two roles cannot both apply", () => {
    const standings = [true, false].map((teachesCourse) =>
      executiveStanding({ role: "Executive", teachesCourse })
    );
    expect(new Set(standings).size).toBe(2);
    expect(standings.every((standing) => standing === "executive" || standing === "pending")).toBe(
      true
    );
  });
});

describe("teachesCourseIds", () => {
  it("counts the tutor who uploaded the course", () => {
    expect(teachesCourseIds([{ created_by: "u1" }]).has("u1")).toBe(true);
  });

  it("counts a co-tutor", () => {
    const ids = teachesCourseIds([{ created_by: "u1", co_tutor_id: "u2" }]);
    expect(ids.has("u2")).toBe(true);
  });

  it("ignores courses with no tutor recorded", () => {
    expect(teachesCourseIds([{ created_by: null, co_tutor_id: "" }]).size).toBe(0);
  });

  it("has nobody teaching when there are no courses", () => {
    expect(teachesCourseIds([]).size).toBe(0);
  });
});
