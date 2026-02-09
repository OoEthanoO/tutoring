import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type SessionUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  email_verified_at: string | null;
};

export const IMPERSONATE_COOKIE = "impersonate_user_id";

export const getAdminClient = () => {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server configuration.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
};

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const getSessionUser = async (token?: string | null) => {
  if (!token) {
    return null;
  }

  const adminClient = getAdminClient();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const { data } = await adminClient
    .from("app_sessions")
    .select(
      "user:app_users(id, email, full_name, role, email_verified_at), expires_at"
    )
    .eq("token_hash", tokenHash)
    .gt("expires_at", now)
    .maybeSingle();

  const resolvedUser = Array.isArray(data?.user)
    ? data.user[0]
    : data?.user;

  if (!resolvedUser) {
    return null;
  }

  return resolvedUser as SessionUser;
};

export const getRequestActor = async (
  request: { cookies: { get: (name: string) => { value?: string } | undefined } }
) => {
  const token = request.cookies.get("session")?.value;
  return getSessionUser(token);
};

export const getRequestUser = async (
  request: { cookies: { get: (name: string) => { value?: string } | undefined } }
) => {
  const actor = await getRequestActor(request);
  if (!actor) {
    return null;
  }

  const actorRole = resolveUserRole(actor.email, actor.role ?? null);
  const impersonatedUserId =
    request.cookies.get(IMPERSONATE_COOKIE)?.value?.trim() ?? "";
  if (actorRole !== "founder" || !impersonatedUserId) {
    return actor;
  }

  const adminClient = getAdminClient();
  const { data: impersonatedUser } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role, email_verified_at")
    .eq("id", impersonatedUserId)
    .maybeSingle();

  if (!impersonatedUser) {
    return actor;
  }

  return impersonatedUser as SessionUser;
};

export const getRequestAuthContext = async (
  request: { cookies: { get: (name: string) => { value?: string } | undefined } }
) => {
  const actor = await getRequestActor(request);
  if (!actor) {
    return {
      actor: null,
      user: null,
      isImpersonating: false,
      impersonatedUserId: null,
    };
  }

  const actorRole = resolveUserRole(actor.email, actor.role ?? null);
  const impersonatedUserId =
    request.cookies.get(IMPERSONATE_COOKIE)?.value?.trim() ?? "";

  if (actorRole !== "founder" || !impersonatedUserId) {
    return {
      actor,
      user: actor,
      isImpersonating: false,
      impersonatedUserId: null,
    };
  }

  const adminClient = getAdminClient();
  const { data: impersonatedUser } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role, email_verified_at")
    .eq("id", impersonatedUserId)
    .maybeSingle();

  if (!impersonatedUser) {
    return {
      actor,
      user: actor,
      isImpersonating: false,
      impersonatedUserId: null,
    };
  }

  return {
    actor,
    user: impersonatedUser as SessionUser,
    isImpersonating: impersonatedUser.id !== actor.id,
    impersonatedUserId: impersonatedUser.id,
  };
};
