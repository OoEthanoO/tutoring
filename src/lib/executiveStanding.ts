/**
 * Executive or Pending: which of the two a tutor holds in Discord.
 *
 * An executive who has not uploaded a single course they teach is Pending —
 * they joined the team but have not started. The founder trio can exempt
 * someone who is on the team without ever teaching (a designer, say), and
 * exempting them makes them a plain Executive.
 *
 * The two are exclusive by construction: this returns one standing, never both,
 * and the Discord sync treats them as a single hierarchy slot.
 *
 * Pure and unit tested — the sync itself cannot be run without a guild.
 */

import type { UserRole } from "./roles";

export type ExecutiveStanding = "executive" | "pending";

export type ExecutiveStandingInput = {
  role: UserRole | null;
  /** Owns or co-teaches at least one course that has not been deleted. */
  teachesCourse: boolean;
  /** Set by the founder trio: on the team without a course of their own. */
  exempt?: boolean;
};

/**
 * The standing of an ordinary executive, or null for anyone this rule does not
 * cover — students, and the ranks above Executive. The founder trio and Chief
 * Executives keep their own role whether or not they teach: they are not
 * waiting to start.
 */
export const executiveStanding = ({
  role,
  teachesCourse,
  exempt = false,
}: ExecutiveStandingInput): ExecutiveStanding | null => {
  // Everything above Executive — the founder trio and Chief Executives — is
  // excluded by this check, since resolveUserRole never returns "Executive"
  // for them.
  if (role !== "Executive" && role !== "executive") {
    return null;
  }
  return teachesCourse || exempt ? "executive" : "pending";
};

/** Does this course put its tutor on the team? Co-teachers count. */
export const teachesCourseIds = (
  courses: { created_by?: string | null; co_tutor_id?: string | null }[]
): Set<string> => {
  const ids = new Set<string>();
  for (const course of courses ?? []) {
    for (const id of [course?.created_by, course?.co_tutor_id]) {
      const value = String(id ?? "").trim();
      if (value) {
        ids.add(value);
      }
    }
  }
  return ids;
};
