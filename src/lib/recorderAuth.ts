import { getSessionUser, type SessionUser } from "@/lib/authServer";
import { canManageCourses, resolveUserRole } from "@/lib/roles";

/**
 * The desktop recorder signs in with the same `app_sessions` tokens as the
 * website, but sends them as a bearer header instead of a cookie (a native app
 * has no cookie jar to share with the site). Only people who can teach may use
 * the recorder.
 */
export const readBearerToken = (request: { headers: { get: (name: string) => string | null } }) => {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
};

export type RecorderUser = SessionUser & { resolvedRole: ReturnType<typeof resolveUserRole> };

export const getRecorderUser = async (request: {
  headers: { get: (name: string) => string | null };
}): Promise<RecorderUser | null> => {
  const token = readBearerToken(request);
  if (!token) {
    return null;
  }
  const user = await getSessionUser(token);
  if (!user) {
    return null;
  }
  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  const resolvedRole = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!canManageCourses(resolvedRole)) {
    return null;
  }
  return { ...user, resolvedRole };
};
