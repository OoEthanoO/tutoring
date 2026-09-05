import { describe, expect, it } from "vitest";
import {
  buildCourseNeedsMessage,
  escapeDiscordMarkdown,
  maxCourseNeeds,
  parseCourseNeeds,
  validateCourseNeeds,
} from "./courseNeeds";

describe("parseCourseNeeds", () => {
  it("takes a single course as typed", () => {
    expect(parseCourseNeeds("Grade 6 French")).toEqual(["Grade 6 French"]);
  });

  it("takes one course per line, ignoring blank lines", () => {
    expect(parseCourseNeeds("Grade 6 French\n\n  Grade 9 Math  \n")).toEqual([
      "Grade 6 French",
      "Grade 9 Math",
    ]);
  });

  it("tolerates pasted list markers", () => {
    expect(parseCourseNeeds("- Grade 6 French\n• Grade 9 Math\n* Grade 11 Chemistry")).toEqual([
      "Grade 6 French",
      "Grade 9 Math",
      "Grade 11 Chemistry",
    ]);
  });

  it("drops duplicates regardless of case and spacing", () => {
    expect(parseCourseNeeds("Grade 6 French\ngrade 6  french")).toEqual(["Grade 6 French"]);
  });

  it("finds nothing in an empty or whitespace-only message", () => {
    expect(parseCourseNeeds("")).toEqual([]);
    expect(parseCourseNeeds("   \n\n  ")).toEqual([]);
  });
});

describe("validateCourseNeeds", () => {
  it("accepts a normal request", () => {
    expect(validateCourseNeeds("Grade 6 French")).toEqual({ ok: true, needs: ["Grade 6 French"] });
  });

  it("refuses to send nothing", () => {
    const result = validateCourseNeeds("  ");
    expect(result.ok).toBe(false);
  });

  it("refuses a list longer than the cap", () => {
    const many = Array.from({ length: maxCourseNeeds + 1 }, (_, index) => `Course ${index}`).join("\n");
    const result = validateCourseNeeds(many);
    expect(result.ok).toBe(false);
  });

  it("refuses a course name that is really a paragraph", () => {
    const result = validateCourseNeeds("x".repeat(200));
    expect(result.ok).toBe(false);
  });
});

describe("escapeDiscordMarkdown", () => {
  it("leaves ordinary course names alone", () => {
    expect(escapeDiscordMarkdown("Grade 6 French")).toBe("Grade 6 French");
  });

  it("escapes characters Discord would treat as formatting", () => {
    expect(escapeDiscordMarkdown("Math *advanced*")).toBe("Math \\*advanced\\*");
    expect(escapeDiscordMarkdown("C++ `code`")).toBe("C++ \\`code\\`");
    expect(escapeDiscordMarkdown("A_B")).toBe("A\\_B");
  });
});

describe("buildCourseNeedsMessage", () => {
  it("asks for one tutor by name", () => {
    const message = buildCourseNeedsMessage({ needs: ["Grade 6 French"] });
    expect(message).toContain("We need a tutor to teach **Grade 6 French**.");
    expect(message).toContain("If you can teach it, send a course request");
    expect(message).toContain("**Course requests**");
    expect(message).toContain("https://learn.ethanyanxu.com");
  });

  it("lists several courses and adjusts the wording", () => {
    const message = buildCourseNeedsMessage({ needs: ["Grade 6 French", "Grade 9 Math"] });
    expect(message).toContain("We need tutors to teach:");
    expect(message).toContain("• **Grade 6 French**");
    expect(message).toContain("• **Grade 9 Math**");
    expect(message).toContain("If you can teach one of these");
  });

  it("leads with the role mentions when there are any", () => {
    const message = buildCourseNeedsMessage({
      needs: ["Grade 6 French"],
      mentions: ["<@&1>", "<@&2>"],
    });
    expect(message.startsWith("<@&1> <@&2> We need a tutor")).toBe(true);
  });

  it("says the same thing without mentions when no roles resolve", () => {
    const message = buildCourseNeedsMessage({ needs: ["Grade 6 French"], mentions: [] });
    expect(message.startsWith("We need a tutor")).toBe(true);
  });

  it("escapes a course name so it cannot break the formatting", () => {
    const message = buildCourseNeedsMessage({ needs: ["Grade 6 **French**"] });
    expect(message).toContain("Grade 6 \\*\\*French\\*\\*");
  });

  it("uses the site URL it is given", () => {
    const message = buildCourseNeedsMessage({ needs: ["x"], siteUrl: "https://example.test" });
    expect(message).toContain("https://example.test");
  });
});
