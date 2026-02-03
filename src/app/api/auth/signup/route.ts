import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getAdminClient, hashToken } from "@/lib/authServer";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
const founderEmail = process.env.NEXT_PUBLIC_FOUNDER_EMAIL ?? "";

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
    | { email?: string; password?: string; fullName?: string }
    | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const fullName = body?.fullName?.trim() ?? "";

  if (!email || !password || !fullName) {
    return NextResponse.json(
      { error: "Email, password, and full name are required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const { data: existing } = await adminClient
    .from("app_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const role = email === founderEmail.toLowerCase() ? "founder" : "student";

  const { data: user, error: insertError } = await adminClient
    .from("app_users")
    .insert({
      email,
      full_name: fullName,
      password_hash: passwordHash,
      role,
    })
    .select("id")
    .single();

  if (insertError || !user) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create account." },
      { status: 500 }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  await adminClient.from("app_email_verifications").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const verifyUrl = `${siteUrl}/auth/verify?token=${token}`;
  await sendEmail(
    email,
    "Verify your email",
    `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
  );

  return NextResponse.json({ success: true });
}
