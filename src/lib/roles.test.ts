import { describe, expect, it } from "vitest";
import {
  canManageCourses,
  isExecutive,
  isFounder,
  resolveRoleByEmail,
  resolveUserRole,
} from "@/lib/roles";

// Uses the fallback founder list (NEXT_PUBLIC_FOUNDER_EMAIL is unset in tests).
const founderEmail = "ethanxucoder@gmail.com";

describe("resolveRoleByEmail", () => {
  it("recognizes hardcoded founders case-insensitively", () => {
    expect(resolveRoleByEmail(founderEmail)).toBe("founder");
    expect(resolveRoleByEmail(founderEmail.toUpperCase())).toBe("founder");
  });

  it("defaults everyone else to student", () => {
    expect(resolveRoleByEmail("someone@example.com")).toBe("student");
    expect(resolveRoleByEmail(null)).toBe("student");
  });
});

describe("resolveUserRole", () => {
  it("lets the founder email override any stored role", () => {
    expect(resolveUserRole(founderEmail, "student")).toBe("founder");
  });

  it("normalizes stored role aliases", () => {
    expect(resolveUserRole("a@b.com", "tutor")).toBe("executive");
    expect(resolveUserRole("a@b.com", "exec")).toBe("executive");
    expect(resolveUserRole("a@b.com", "junior exec")).toBe("Junior Executive");
    expect(resolveUserRole("a@b.com", "ceo")).toBe("CEO");
    expect(resolveUserRole("a@b.com", "chief executive")).toBe("Chief Executive");
  });

  it("falls back to student for unknown or missing roles", () => {
    expect(resolveUserRole("a@b.com", "wizard")).toBe("student");
    expect(resolveUserRole("a@b.com", null)).toBe("student");
    expect(resolveUserRole(null, null)).toBe("student");
  });

  it("picks the highest-priority custom role level", () => {
    expect(
      resolveUserRole("a@b.com", "student", ["Junior Executive", "CEO"])
    ).toBe("CEO");
  });

  it("does not let a custom role level downgrade a hardcoded founder", () => {
    expect(resolveUserRole(founderEmail, null, ["executive"])).toBe("founder");
  });

  it("lets a custom role level upgrade a regular user", () => {
    expect(resolveUserRole("a@b.com", "student", "COO")).toBe("COO");
  });
});

describe("role predicates", () => {
  it("isExecutive covers every executive tier", () => {
    expect(isExecutive("founder")).toBe(true);
    expect(isExecutive("CEO")).toBe(true);
    expect(isExecutive("Chief Executive")).toBe(true);
    expect(isExecutive("executive")).toBe(true);
    expect(isExecutive("Junior Executive")).toBe(true);
    expect(isExecutive("student")).toBe(false);
    expect(isExecutive(null)).toBe(false);
  });

  // NOTE: isFounder intentionally (per current implementation) includes CEO
  // and COO. The admin API routes are stricter — they compare the resolved
  // role to the literal "founder" — so CEO/COO users pass client-side
  // isFounder gates but are rejected by the admin APIs.
  it("isFounder covers founder, CEO, and COO", () => {
    expect(isFounder("founder")).toBe(true);
    expect(isFounder("CEO")).toBe(true);
    expect(isFounder("COO")).toBe(true);
    expect(isFounder("Chief Executive")).toBe(false);
    expect(isFounder("executive")).toBe(false);
    expect(isFounder(null)).toBe(false);
  });

  it("canManageCourses covers founder through Junior Executive", () => {
    expect(canManageCourses("founder")).toBe(true);
    expect(canManageCourses("Chief Executive")).toBe(true);
    expect(canManageCourses("executive")).toBe(true);
    expect(canManageCourses("Junior Executive")).toBe(true);
    expect(canManageCourses("student")).toBe(false);
    expect(canManageCourses(null)).toBe(false);
  });
});
