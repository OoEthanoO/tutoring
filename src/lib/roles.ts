export type UserRole = "founder" | "student";

const fallbackFounderEmail = "ethanxucoder@gmail.com";

export const founderEmail =
  process.env.NEXT_PUBLIC_FOUNDER_EMAIL ?? fallbackFounderEmail;

export const resolveRole = (email?: string | null): UserRole => {
  if (!email) {
    return "student";
  }

  return email.toLowerCase() === founderEmail.toLowerCase()
    ? "founder"
    : "student";
};
