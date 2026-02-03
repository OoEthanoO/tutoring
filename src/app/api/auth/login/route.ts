import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getAdminClient, hashToken } from "@/lib/authServer";

const SESSION_COOKIE = "session";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { email?: string; password?: string }
    | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const { data: user, error } = await adminClient
    .from("app_users")
    .select("id, email, password_hash, email_verified_at, full_name, role")
    .eq("email", email)
    .maybeSingle();

  if (error || !user) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (!user.email_verified_at) {
    return NextResponse.json(
      { error: "Please verify your email before signing in." },
      { status: 401 }
    );
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  await adminClient.from("app_sessions").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      email_verified_at: user.email_verified_at,
    },
  });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
