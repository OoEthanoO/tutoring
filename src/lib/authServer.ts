import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type SessionUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  email_verified_at: string | null;
};

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

  if (!data?.user) {
    return null;
  }

  return data.user as SessionUser;
};

export const getRequestUser = async (
  request: { cookies: { get: (name: string) => { value?: string } | undefined } }
) => {
  const token = request.cookies.get("session")?.value;
  return getSessionUser(token);
};
