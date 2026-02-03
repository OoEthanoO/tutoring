import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authServer";

const SESSION_COOKIE = "session";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({ user });
}
