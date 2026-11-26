/**
 * The six-month window for Pending executives.
 *
 * An executive who has never owned or co-taught a course is Pending
 * (executiveStanding.ts). Someone still Pending six months after being
 * promoted from student is turned back into a student automatically.
 *
 * Pure and unit tested; the database side is pendingExecutivesServer.ts.
 */

import { executiveStanding } from "./executiveStanding";
import type { UserRole } from "./roles";

export const PENDING_WINDOW_MONTHS = 6;

/**
 * The moment the window closes: the same day of the month and time, six
 * calendar months after the promotion (UTC). A day the later month does not
 * have (31 August + 6 months) becomes that month's last day. Null for a
 * missing or unreadable date.
 */
export const pendingDeadlineMs = (promotedAt: string | null | undefined): number | null => {
  if (!promotedAt) return null;
  const start = new Date(promotedAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime());
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + PENDING_WINDOW_MONTHS);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end.getTime();
};

export type PendingWindowInput = {
  /** resolveUserRole's answer, custom roles included. */
  role: UserRole | null;
  /** Owns or co-teaches at least one course that has not been deleted. */
  teachesCourse: boolean;
  /** The trio's "Executive without a course" tick. */
  exempt: boolean;
  /** app_users.tutor_promoted_at. */
  promotedAt: string | null | undefined;
  /** Has a course request waiting for management's decision. */
  hasOpenCourseRequest: boolean;
};

/**
 * Should this account be turned back into a student now?
 *
 * Only an ordinary executive who is Pending: the ranks above Executive,
 * anyone who teaches or has taught a course that still exists, and anyone the
 * trio exempted are never touched. Without a promotion date there is nothing
 * to count from, so the account is left alone. A course request still waiting
 * for management holds the demotion: the wait is not the executive's.
 */
export const pendingWindowExpired = (input: PendingWindowInput, nowMs: number): boolean => {
  const standing = executiveStanding({
    role: input.role,
    teachesCourse: input.teachesCourse,
    exempt: input.exempt,
  });
  if (standing !== "pending" || input.hasOpenCourseRequest) return false;
  const deadline = pendingDeadlineMs(input.promotedAt);
  return deadline !== null && nowMs >= deadline;
};
