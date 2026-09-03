import { describe, expect, it } from "vitest";
import {
  countTeamMembers,
  isCountedTeamMember,
  isTeamRosterMember,
  type TeamRosterCandidate,
} from "./teamRoster";

// Only "tutor-with-a-course" is in this set; everyone else owns no course.
const creators = new Set(["tutor-with-a-course"]);

const executive: TeamRosterCandidate = { id: "exec", role: "tutor" };
const founder: TeamRosterCandidate = { id: "founder", role: "founder" };
const designer: TeamRosterCandidate = { id: "designer", role: "student", customRole: "Graphic Designer" };
const student: TeamRosterCandidate = { id: "student", role: "student" };
const juniorTeaching: TeamRosterCandidate = {
  id: "tutor-with-a-course",
  role: "tutor",
  isJunior: true,
};
const juniorNotTeaching: TeamRosterCandidate = { id: "junior", role: "tutor", isJunior: true };
// A plain student account that happens to carry the is_junior flag.
const flaggedStudent: TeamRosterCandidate = { id: "flagged", role: "student", isJunior: true };

describe("isTeamRosterMember (names on the Our team page)", () => {
  it("lists executives, founders, and custom-role members", () => {
    expect(isTeamRosterMember(executive, creators)).toBe(true);
    expect(isTeamRosterMember(founder, creators)).toBe(true);
    expect(isTeamRosterMember(designer, creators)).toBe(true);
  });

  it("does not list plain students", () => {
    expect(isTeamRosterMember(student, creators)).toBe(false);
  });

  it("lists a junior only once they own a course", () => {
    expect(isTeamRosterMember(juniorTeaching, creators)).toBe(true);
    expect(isTeamRosterMember(juniorNotTeaching, creators)).toBe(false);
  });
});

describe("isCountedTeamMember (public team size)", () => {
  it("counts everyone listed on the roster", () => {
    for (const user of [executive, founder, designer, juniorTeaching]) {
      expect(isCountedTeamMember(user, creators)).toBe(true);
    }
  });

  it("counts a junior executive who has not taught yet, unlike the roster", () => {
    expect(isCountedTeamMember(juniorNotTeaching, creators)).toBe(true);
    expect(isTeamRosterMember(juniorNotTeaching, creators)).toBe(false);
  });

  it("does not count a student carrying the is_junior flag", () => {
    // The flag alone does not make someone a junior executive; counting them
    // would overstate the team size against the analytics executive count.
    expect(isCountedTeamMember(flaggedStudent, creators)).toBe(false);
  });

  it("does not count plain students", () => {
    expect(isCountedTeamMember(student, creators)).toBe(false);
  });
});

describe("countTeamMembers", () => {
  it("counts the roster plus untaught junior executives only", () => {
    const everyone = [
      executive,
      founder,
      designer,
      student,
      juniorTeaching,
      juniorNotTeaching,
      flaggedStudent,
    ];
    expect(countTeamMembers(everyone, creators)).toBe(5);
  });
});
