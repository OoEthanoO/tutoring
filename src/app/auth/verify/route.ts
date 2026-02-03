import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, hashToken } from "@/lib/authServer";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.redirect(new URL("/auth/verified?status=invalid", request.url));
  }

  const adminClient = getAdminClient();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const { data: record } = await adminClient
    .from("app_email_verifications")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", now)
    .maybeSingle();

  if (!record) {
    return NextResponse.redirect(new URL("/auth/verified?status=invalid", request.url));
  }

  await adminClient
    .from("app_users")
    .update({ email_verified_at: now })
    .eq("id", record.user_id);

  await adminClient
    .from("app_email_verifications")
    .delete()
    .eq("id", record.id);

  return NextResponse.redirect(new URL("/auth/verified?status=verified", request.url));
}
