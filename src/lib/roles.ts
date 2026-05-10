export type UserRole = "CEO" | "COO" | "Chief Executive" | "founder" | "Executive" | "executive" | "Junior Executive" | "Student" | "student";

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
  const value = role.toLowerCase();
  
  if (value === "ceo") return "CEO";
  if (value === "coo") return "COO";
  if (value === "chief executive") return "Chief Executive";
  if (value === "executive") return "executive";
  if (value === "junior executive") return "Junior Executive";
  if (value === "founder") return "founder";
  if (value === "student") return "student";
  if (value === "tutor") return "executive";
  if (value === "exec") return "executive";
  if (value === "junior exec") return "Junior Executive";

  return null;
};

export const resolveUserRole = (
  email?: string | null,
  roleValue?: string | null,
  customRoleLevel?: string | string[] | null
): UserRole => {
  const customLevels = Array.isArray(customRoleLevel) ? customRoleLevel : (customRoleLevel ? [customRoleLevel] : []);
  
  let bestCustomMatch: UserRole | null = null;
  const rolePriority: Record<UserRole, number> = {
    founder: 100,
    CEO: 90,
    COO: 80,
    "Chief Executive": 70,
    Executive: 60,
    executive: 60,
    "Junior Executive": 50,
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
  role === "Chief Executive" ||
  role === "Executive" ||
  role === "executive" ||
  role === "Junior Executive";

export const isFounder = (role: UserRole | null): boolean =>
  role === "founder" || role === "CEO" || role === "COO";

export const isHighRankingChiefExecutive = (role: UserRole | null): boolean =>
  role === "founder" || role === "CEO" || role === "COO";

export const canManageCourses = (role: UserRole | null): boolean =>
  role ? (isFounder(role) || role === "Chief Executive" || role === "Executive" || role === "executive" || role === "Junior Executive") : false;
