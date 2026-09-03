import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, hashToken } from "@/lib/authServer";
import { readBearerToken } from "@/lib/recorderAuth";

/** Revoke the recorder's session token. */
export async function POST(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const adminClient = getAdminClient();
  await adminClient.from("app_sessions").delete().eq("token_hash", hashToken(token));
  return NextResponse.json({ ok: true });
}
