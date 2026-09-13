import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminClient,
  getRequestActor,
  IMPERSONATE_COOKIE,
} from "@/lib/authServer";
import { isFounder, resolveAccountRole, canImpersonateAccount, leadershipProtectionMessage } from "@/lib/roles";

const maxCookieAgeSeconds = 60 * 60 * 24 * 30;

export async function POST(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isFounder(resolveAccountRole(actor))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { userId?: string }
    | null;
  const userId = body?.userId?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId." }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const { data: targetUser, error } = await adminClient
    .from("app_users")
    .select("id, email, role, custom_role, custom_roles(role_level)")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not verify the target account." }, { status: 503 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (!canImpersonateAccount(resolveAccountRole(actor), resolveAccountRole(targetUser))) {
    return NextResponse.json({ error: leadershipProtectionMessage }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: IMPERSONATE_COOKIE,
    value: userId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxCookieAgeSeconds,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isFounder(resolveAccountRole(actor))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: IMPERSONATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
