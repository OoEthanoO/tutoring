import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getAdminClient, hashToken } from "@/lib/authServer";
import { canManageCourses, founderEmails, isFounder, resolveUserRole } from "@/lib/roles";
import { getMaintenanceMode } from "@/lib/siteSettings";

/** Recorder sign-ins last this long; the app refreshes by signing in again. */
const recorderSessionMs = 1000 * 60 * 60 * 24 * 90;

/**
 * Sign the YanLearn Recorder desktop app in. Same credentials and session table
 * as the website, but the token is returned in the body (the app sends it as a
 * bearer header) and only people who can teach get one.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        email?: string;
        password?: string;
        deviceId?: string;
        deviceName?: string;
        platform?: string;
        appVersion?: string;
      }
    | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const deviceId = String(body?.deviceId ?? "").trim();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (!deviceId) {
    return NextResponse.json({ error: "Missing device id." }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const { data: user, error } = await adminClient
    .from("app_users")
    .select("id, email, password_hash, email_verified_at, full_name, role, custom_roles(role_level)")
    .eq("email", email)
    .maybeSingle();

  if (error || !user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (!user.email_verified_at) {
    return NextResponse.json(
      { error: "Please verify your email before signing in." },
      { status: 401 }
    );
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r: { role_level: string }) => r.role_level).filter(Boolean)
    : [];
  const userRole = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!canManageCourses(userRole)) {
    return NextResponse.json(
      { error: "YanLearn Recorder is for tutors. This account cannot teach classes." },
      { status: 403 }
    );
  }

  const maintenanceEnabled = await getMaintenanceMode();
  const isFounderAccount =
    isFounder(userRole) ||
    founderEmails.some((f) => f.toLowerCase() === user.email.toLowerCase());
  if (maintenanceEnabled && !isFounderAccount) {
    return NextResponse.json(
      { error: "The website is currently under maintenance." },
      { status: 503 }
    );
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const { error: sessionError } = await adminClient.from("app_sessions").insert({
    user_id: user.id,
    token_hash: hashToken(sessionToken),
    expires_at: new Date(Date.now() + recorderSessionMs).toISOString(),
  });
  if (sessionError) {
    return NextResponse.json({ error: "Failed to create a session." }, { status: 500 });
  }

  const now = new Date().toISOString();
  await adminClient.from("recorder_sessions").upsert(
    {
      tutor_id: user.id,
      device_id: deviceId,
      device_name: String(body?.deviceName ?? "").slice(0, 120) || null,
      platform: String(body?.platform ?? "").slice(0, 40) || null,
      app_version: String(body?.appVersion ?? "").slice(0, 40) || null,
      last_state: "signed_in",
      last_seen_at: now,
    },
    { onConflict: "tutor_id,device_id" }
  );

  return NextResponse.json({
    token: sessionToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name ?? "",
      role: userRole,
    },
  });
}
