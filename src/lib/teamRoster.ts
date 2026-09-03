// Visibility rules for the public team roster, and who counts towards the
// public team size. Kept in one place so the Our team tab, the home-page team
// count, and the impact page's volunteer tutors are computed from the same
// data. The count is a superset of the roster: see isCountedTeamMember.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TeamRosterCandidate = {
  id: string;
  role?: string | null;
  customRole?: string | null;
  isJunior?: boolean | null;
};

export const normalizeStandardRole = (role: string | null | undefined) => {
  const value = String(role ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "founder") return "founder";
  if (value === "ceo") return "CEO";
  if (value === "coo") return "COO";
  if (value === "chief executive") return "Chief Executive";
  if (value === "executive" || value === "exec" || value === "tutor") return "Executive";
  if (value === "junior executive" || value === "junior exec") return "Junior Executive";
  return null;
};

// A custom role label that is not one of the standard roles still puts the
// user on the roster (e.g. "Graphic Designer").
const isCustomOnlyRole = (role: string | null | undefined) => {
  const label = String(role ?? "").trim();
  return Boolean(label && !normalizeStandardRole(label));
};

/**
 * Whether a user holds a role that puts them on the team at all, ignoring the
 * junior "must own a course" rule below.
 */
const hasTeamRole = (user: TeamRosterCandidate): boolean => {
  if (isCustomOnlyRole(user.customRole)) {
    return true;
  }
  // normalizeStandardRole maps anything unrecognized (including "student") to
  // null, so a non-null role here always means a roster role.
  return (normalizeStandardRole(user.customRole) ?? normalizeStandardRole(user.role)) !== null;
};

// Juniors only appear by name once they own at least one course.
export const isTeamRosterMember = (
  user: TeamRosterCandidate,
  activeCreatorIds: Set<string>
) => {
  if (user.isJunior) {
    return activeCreatorIds.has(user.id);
  }
  return hasTeamRole(user);
};

/**
 * Who counts towards the public team size: everyone on the roster, plus junior
 * executives who have not taught a course yet and so are not listed by name on
 * the Our team page (decided September 2026).
 *
 * A junior must still hold an executive role to count. `is_junior` is a flag
 * that can sit on a plain student account, and such a person is not a junior
 * executive — counting them would overstate the team size.
 */
export const isCountedTeamMember = (
  user: TeamRosterCandidate,
  activeCreatorIds: Set<string>
) =>
  isTeamRosterMember(user, activeCreatorIds) ||
  (Boolean(user.isJunior) && hasTeamRole(user));

export const countTeamMembers = (
  users: TeamRosterCandidate[],
  activeCreatorIds: Set<string>
) => users.filter((user) => isCountedTeamMember(user, activeCreatorIds)).length;

// Public-safe roster entry: display fields only, never an email address.
export type TeamRosterMember = {
  id: string;
  name: string;
  role: string | null;
  customRole: string | null;
  isJunior: boolean;
  generation: string | number | null;
};

type TeamUserRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  custom_role: string | null;
  is_junior: boolean | null;
  executive_generation: string | number | null;
};

const toCandidate = (user: TeamUserRow): TeamRosterCandidate => ({
  id: String(user.id),
  role: user.role ?? null,
  customRole: user.custom_role ?? null,
  isJunior: user.is_junior ?? null,
});

const loadTeamCandidates = async (
  adminClient: SupabaseClient
): Promise<{ users: TeamUserRow[]; activeCreatorIds: Set<string> }> => {
  const [usersResult, coursesResult] = await Promise.all([
    adminClient
      .from("app_users")
      .select("id, full_name, role, custom_role, is_junior, executive_generation"),
    adminClient.from("courses").select("created_by"),
  ]);

  if (usersResult.error || !usersResult.data) {
    throw new Error(usersResult.error?.message ?? "Failed to load team.");
  }
  if (coursesResult.error || !coursesResult.data) {
    throw new Error(coursesResult.error?.message ?? "Failed to load courses.");
  }

  const activeCreatorIds = new Set(
    coursesResult.data
      .map((course) => course.created_by)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  return { users: usersResult.data as TeamUserRow[], activeCreatorIds };
};

/** The people listed by name on the Our team page (/api/team/roster). */
export async function fetchTeamRoster(
  adminClient: SupabaseClient
): Promise<TeamRosterMember[]> {
  const { users, activeCreatorIds } = await loadTeamCandidates(adminClient);
  return users
    .filter((user) => isTeamRosterMember(toCandidate(user), activeCreatorIds))
    .map((user) => ({
      id: String(user.id),
      name: String(user.full_name ?? "").trim(),
      role: user.role ?? null,
      customRole: user.custom_role ?? null,
      isJunior: Boolean(user.is_junior),
      generation: user.executive_generation ?? null,
    }));
}

/**
 * The public team size (/api/team/count, the impact page's volunteer tutors):
 * the roster plus every junior executive.
 */
export async function fetchTeamCount(adminClient: SupabaseClient): Promise<number> {
  const { users, activeCreatorIds } = await loadTeamCandidates(adminClient);
  return countTeamMembers(users.map(toCandidate), activeCreatorIds);
}
