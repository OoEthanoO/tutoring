import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { getAdminClient, hashToken } from "@/lib/authServer";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; password?: string }
    | null;

  const token = body?.token ?? "";
  const password = body?.password ?? "";

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token and new password are required." },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const { data: resetRecord } = await adminClient
    .from("app_password_resets")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!resetRecord) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  if (new Date(resetRecord.expires_at) < new Date(now)) {
    // Clean up expired token
    await adminClient
      .from("app_password_resets")
      .delete()
      .eq("id", resetRecord.id);

    return NextResponse.json(
      { error: "This reset link has expired. Please request a new one." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { error: updateError } = await adminClient
    .from("app_users")
    .update({ password_hash: passwordHash })
    .eq("id", resetRecord.user_id);

  if (updateError) {
    return NextResponse.json(
      { error: "Unable to update password." },
      { status: 500 }
    );
  }

  // Delete all reset tokens for this user
  await adminClient
    .from("app_password_resets")
    .delete()
    .eq("user_id", resetRecord.user_id);

  // Invalidate all existing sessions so the user must sign in with the new password
  await adminClient
    .from("app_sessions")
    .delete()
    .eq("user_id", resetRecord.user_id);

  return NextResponse.json({ success: true });
}
