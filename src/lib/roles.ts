export type UserRole = "founder" | "executive" | "student";

const fallbackFounderEmail = "ethans.coding.class@gmail.com";

export const founderEmail =
  process.env.NEXT_PUBLIC_FOUNDER_EMAIL ?? fallbackFounderEmail;

export const resolveRoleByEmail = (email?: string | null): UserRole => {
  if (!email) {
    return "student";
  }

  return email.toLowerCase() === founderEmail.toLowerCase()
    ? "founder"
    : "student";
};

const normalizeRole = (role?: string | null): UserRole | null => {
  if (!role) {
    return null;
  }

  const value = role.toLowerCase();

  if (
    value === "founder" ||
    value === "executive" ||
    value === "student" ||
    value === "tutor"
  ) {
    return (value === "tutor" ? "executive" : value) as UserRole;
  }

  return null;
};

export const resolveUserRole = (
  email?: string | null,
  roleValue?: string | null
): UserRole => {
  const emailRole = resolveRoleByEmail(email);
  if (emailRole === "founder") {
    return "founder";
  }

  const role = normalizeRole(roleValue);
  if (role === "executive") {
    return "executive";
  }

  return "student";
};

export const canManageCourses = (role: UserRole): boolean =>
  role === "founder" || role === "executive";
