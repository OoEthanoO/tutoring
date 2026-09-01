// Visibility rules for the public team roster. Kept in one place so the
// public team count and the Our team tab agree on who counts as a member.

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

// Juniors only appear once they own at least one course.
export const isTeamRosterMember = (
  user: TeamRosterCandidate,
  activeCreatorIds: Set<string>
) => {
  if (user.isJunior) {
    return activeCreatorIds.has(user.id);
  }
  if (isCustomOnlyRole(user.customRole)) {
    return true;
  }
  // normalizeStandardRole maps anything unrecognized (including "student") to
  // null, so a non-null role here always means a roster role.
  const effectiveRole =
    normalizeStandardRole(user.customRole) ?? normalizeStandardRole(user.role);
  return effectiveRole !== null;
};

export const countTeamMembers = (
  users: TeamRosterCandidate[],
  activeCreatorIds: Set<string>
) => users.filter((user) => isTeamRosterMember(user, activeCreatorIds)).length;

// Shared by /api/team/count and /api/impact so the home-page team size and the
// impact page's volunteer tutors are always the same number.
export async function fetchTeamCount(adminClient: SupabaseClient): Promise<number> {
  const [usersResult, coursesResult] = await Promise.all([
    adminClient.from("app_users").select("id, role, custom_role, is_junior"),
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

  return countTeamMembers(
    usersResult.data.map((user) => ({
      id: user.id as string,
      role: user.role ?? null,
      customRole: user.custom_role ?? null,
      isJunior: user.is_junior ?? null,
    })),
    activeCreatorIds
  );
}
