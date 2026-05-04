export type UserRole = "CEO" | "COO" | "Chief Executive" | "founder" | "Executive" | "executive" | "Junior Executive" | "Student" | "student";

const fallbackFounderEmails = [
  "ethanyanxu@icloud.com",
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
  customRoleLevel?: string | null
): UserRole => {
  if (customRoleLevel) {
    const matched = normalizeRole(customRoleLevel);
    if (matched) {
       // if it's a valid level, we might just return it, though we need to make sure ethanyanxu still has founder access implicitly or CEO access
       // let's just return the custom level
       const emailRole = resolveRoleByEmail(email);
       if (emailRole === 'founder' && (matched === 'Student' || matched === 'student' || matched === 'executive' || matched === 'Executive' || matched === 'Junior Executive')) {
         return 'founder'; // Don't downgrade hardcoded founders!
       }
       return matched;
    }
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

export const canManageCourses = (role: UserRole | null): boolean =>
  role ? (isFounder(role) || role === "Chief Executive" || role === "Executive" || role === "executive") : false;
