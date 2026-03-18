import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { getAdminClient, hashToken } from "@/lib/authServer";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!resendApiKey || !resendFrom || !to) {
    return;
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to,
      subject,
      html,
    }),
  });
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string }
    | null;

  const email = body?.email?.trim().toLowerCase() ?? "";

  if (!email) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 }
    );
  }

  // Always return success to avoid leaking whether an account exists
  const successResponse = NextResponse.json({ success: true });

  const adminClient = getAdminClient();
  const { data: user } = await adminClient
    .from("app_users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (!user) {
    return successResponse;
  }

  // Delete any existing reset tokens for this user
  await adminClient
    .from("app_password_resets")
    .delete()
    .eq("user_id", user.id);

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour

  await adminClient.from("app_password_resets").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const resetUrl = `${siteUrl}/auth/reset-password?token=${token}`;
  await sendEmail(
    user.email,
    "Reset your password",
    `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p>`
  );

  return successResponse;
}
