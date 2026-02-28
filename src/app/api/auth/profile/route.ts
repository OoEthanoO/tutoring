import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getSessionUser } from "@/lib/authServer";

const SESSION_COOKIE = "session";

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { fullName?: string; discordUsername?: string }
    | null;

  if (body?.fullName === undefined && body?.discordUsername === undefined) {
    return NextResponse.json(
      { error: "Full name must be provided." },
      { status: 400 }
    );
  }

  if (body?.discordUsername !== undefined) {
    return NextResponse.json(
      {
        error:
          "Manual Discord username updates are disabled. Use Connect Discord.",
      },
      { status: 400 }
    );
  }

  const fullName = body?.fullName?.trim() ?? "";
  if (!fullName) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (fullName) updates.full_name = fullName;

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("app_users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to update profile." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
