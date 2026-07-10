import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { getAdminClient, hashToken } from "@/lib/authServer";
import { sendEmail } from "@/lib/notificationsServer";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  try {
    const adminClient = getAdminClient();

    const { data: user } = await adminClient
      .from("app_users")
      .select("id, email, full_name, email_verified_at")
      .eq("email", email)
      .maybeSingle();

    // Don't reveal whether a user exists — respond success for unknown emails.
    if (!user) {
      return NextResponse.json({ success: true });
    }

    if (user.email_verified_at) {
      return NextResponse.json({ success: true, message: "Already verified." });
    }

    // Remove any existing verification tokens for this user to avoid duplicates.
    await adminClient.from("app_email_verifications").delete().eq("user_id", user.id);

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

    await adminClient.from("app_email_verifications").insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const verifyUrl = `${siteUrl}/auth/verify?token=${token}`;

    // Best-effort send; do not fail the request if email sending fails.
    try {
      await sendEmail(
        email,
        "Verify your email",
        `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
      );
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error in resend verification:", err);
    return NextResponse.json({ success: true });
  }
}
