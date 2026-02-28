import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, hashToken } from "@/lib/authServer";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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

  const { data: verifiedUser } = await adminClient
    .from("app_users")
    .update({ email_verified_at: now })
    .eq("id", record.user_id)
    .select("email, full_name")
    .single();

  await adminClient
    .from("app_email_verifications")
    .delete()
    .eq("id", record.id);

  const verifiedEmail = String(verifiedUser?.email ?? "").trim();
  if (verifiedEmail) {
    const name = String(verifiedUser?.full_name ?? "").trim();
    const greetingName = escapeHtml(name || "there");
    const dashboardUrl = siteUrl || request.nextUrl.origin;

    const html = `
      <p>Hi ${greetingName},</p>
      <p>Welcome to YanLearn. Your email has been verified.</p>
      <p>To join the Discord community, follow these steps in YanLearn:</p>
      <p><strong>How to connect your Discord:</strong></p>
      <ol>
        <li>Sign in and click your profile card in the top-right corner.</li>
        <li>Click <strong>Connect Discord</strong> and authorize your Discord account.</li>
        <li>After authorization, you will be redirected directly to the Discord server invite page to join.</li>
      </ol>
      <p>If you authorized Discord but closed that tab before joining, open your profile card and click <strong>Join Discord Server</strong> to retry.</p>
      <p><a href="${dashboardUrl}">Open YanLearn</a></p>
    `;

    try {
      await sendEmail(
        verifiedEmail,
        "Welcome to YanLearn - Join the Discord community",
        html
      );
    } catch {
      // Verification should still succeed even if welcome email delivery fails.
    }
  }

  return NextResponse.redirect(new URL("/auth/verified?status=verified", request.url));
}
