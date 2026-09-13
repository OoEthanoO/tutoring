import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canManageAccountAccess, isLeadershipShadow, leadershipProtectionMessage,
  resolveAccountRole, type AccountRole,
} from "@/lib/roles";

export type ProtectionError = { error: string; status: number };

/** Read the target's authoritative role before any access-changing side effect. */
export async function checkLeadershipProtection(
  admin: SupabaseClient,
  actor: AccountRole,
  target: { id: string } | { email: string },
): Promise<ProtectionError | null> {
  const actorRole = resolveAccountRole(actor);
  if (!isLeadershipShadow(actorRole)) return null;
  const query = admin.from("app_users").select("email, role, custom_role, custom_roles(role_level)");
  const { data, error } = await ("id" in target
    ? query.eq("id", target.id)
    : query.ilike("email", target.email.replace(/[%_\\]/g, "\\$&"))
  ).maybeSingle();
  if (error) return { error: "Could not verify the account's access. Please try again.", status: 503 };
  // Founder emails remain protected even when no account exists yet.
  const targetRole = resolveAccountRole(data ?? ("email" in target ? target : {}));
  return canManageAccountAccess(actorRole, targetRole)
    ? null : { error: leadershipProtectionMessage, status: 403 };
}
