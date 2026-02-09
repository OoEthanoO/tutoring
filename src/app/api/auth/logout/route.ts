import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, hashToken, IMPERSONATE_COOKIE } from "@/lib/authServer";

const SESSION_COOKIE = "session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const adminClient = getAdminClient();
    await adminClient
      .from("app_sessions")
      .delete()
      .eq("token_hash", hashToken(token));
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set({
    name: IMPERSONATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
