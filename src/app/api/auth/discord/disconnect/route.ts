import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestActor } from "@/lib/authServer";

export async function POST(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("app_users")
    .update({
      discord_user_id: null,
      discord_username: null,
      discord_connected_at: null,
    })
    .eq("id", actor.id);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to disconnect Discord account." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
