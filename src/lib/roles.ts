export type UserRole = "CEO" | "COO" | "CEO Shadow" | "COO Shadow" | "Chief Executive" | "founder" | "Executive" | "executive" | "Student" | "student";

const fallbackFounderEmails = [
  "ethanxucoder@gmail.com",
  "jingqu2018@gmail.com",
];

export const founderEmails = process.env.NEXT_PUBLIC_FOUNDER_EMAIL
  ? process.env.NEXT_PUBLIC_FOUNDER_EMAIL.split(",").map((email) =>
      email.trim()
    )
  : fallbackFounderEmails;

export const resolveRoleByEmail = (email?: string | null): UserRole => {
  if (!email) {
    return "student";
  }
  return founderEmails.some(
    (founder) => email.toLowerCase() === founder.toLowerCase()
  )
    ? "founder"
    : "student";
};

const normalizeRole = (role?: string | null): UserRole | null => {
  if (!role) {
    return null;
  }
  const value = role.trim().toLowerCase();
  
  if (value === "ceo") return "CEO";
  if (value === "coo") return "COO";
  if (value === "ceo shadow") return "CEO Shadow";
  if (value === "coo shadow") return "COO Shadow";
  if (value === "chief executive") return "Chief Executive";
  if (value === "executive") return "executive";
  // Junior Executive was retired in September 2026; anyone still stored with
  // it is an executive whose Discord role is decided by whether they teach a
  // course (see executiveStanding.ts).
  if (value === "junior executive") return "executive";
  if (value === "founder") return "founder";
  if (value === "student") return "student";
  if (value === "tutor") return "executive";
  if (value === "exec") return "executive";
  if (value === "junior exec") return "executive";

  return null;
};

export const resolveUserRole = (
  email?: string | null,
  roleValue?: string | null,
  customRoleLevel?: string | string[] | null
): UserRole => {
  const customLevels = Array.isArray(customRoleLevel) ? customRoleLevel : (customRoleLevel ? [customRoleLevel] : []);
  
  let bestCustomMatch: UserRole | null = normalizeRole(roleValue);
  const rolePriority: Record<UserRole, number> = {
    founder: 100,
    CEO: 90,
    COO: 80,
    "CEO Shadow": 76,
    "COO Shadow": 75,
    "Chief Executive": 70,
    Executive: 60,
    executive: 60,
    Student: 10,
    student: 10,
  };

  for (const level of customLevels) {
    const matched = normalizeRole(level);
    if (matched) {
      if (!bestCustomMatch || rolePriority[matched] > rolePriority[bestCustomMatch]) {
        bestCustomMatch = matched;
      }
    }
  }

  if (bestCustomMatch) {
     const emailRole = resolveRoleByEmail(email);
     if (emailRole === 'founder' && rolePriority[bestCustomMatch] < rolePriority['founder']) {
       return 'founder'; // Don't downgrade hardcoded founders!
     }
     return bestCustomMatch;
  }

  const emailRole = resolveRoleByEmail(email);
  if (emailRole === "founder") {
    return "founder";
  }

  const role = normalizeRole(roleValue);
  if (role) {
    return role;
  }

  return "student";
};

export const isExecutive = (role: UserRole | null): boolean =>
  role === "founder" ||
  role === "CEO" ||
  role === "COO" ||
  role === "CEO Shadow" ||
  role === "COO Shadow" ||
  role === "Chief Executive" ||
  role === "Executive" ||
  role === "executive";

export const isTopLeadership = (role: UserRole | null): boolean =>
  role === "founder" || role === "CEO" || role === "COO";

export const isLeadershipShadow = (role: UserRole | null): boolean =>
  role === "CEO Shadow" || role === "COO Shadow";

// Historical name used by the management gates throughout the website.
// Identity/hierarchy checks must use isTopLeadership instead.
export const isFounder = (role: UserRole | null): boolean =>
  isTopLeadership(role) || isLeadershipShadow(role);

export const isHighRankingChiefExecutive = (role: UserRole | null): boolean =>
  isFounder(role);

export const canManageCourses = (role: UserRole | null): boolean =>
  role ? (isFounder(role) || role === "Chief Executive" || role === "Executive" || role === "executive") : false;

export type AccountRole = {
  email?: string | null;
  role?: string | null;
  custom_role?: string | null;
  custom_roles?: { role_level?: string | null } | { role_level?: string | null }[] | null;
};

export const resolveAccountRole = (account: AccountRole): UserRole => {
  const definitions = Array.isArray(account.custom_roles) ? account.custom_roles : [account.custom_roles];
  return resolveUserRole(account.email, account.role, [
    ...definitions.map((role) => role?.role_level).filter((level): level is string => Boolean(level)),
    // Reserved titles retain their identity even with an old role definition.
    ...(account.custom_role ? [account.custom_role] : []),
  ]);
};

export const canManageAccountAccess = (actor: UserRole | null, target: UserRole | null): boolean =>
  isFounder(actor) && !(isLeadershipShadow(actor) && isTopLeadership(target));

export const canAssignRole = (actor: UserRole | null, targetRole: UserRole | null): boolean =>
  isFounder(actor) && !(isLeadershipShadow(actor) && isTopLeadership(targetRole));

export const canImpersonateAccount = canManageAccountAccess;

export const leadershipProtectionMessage = "CEO Shadow and COO Shadow cannot change the access of the founder, CEO, or COO.";
