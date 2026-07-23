import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("discord_sync_status")
    .eq("id", true)
    .single();

  // Missing row/column (migration not applied yet) reads as "nothing recorded"
  // rather than an error, so the panel stays usable.
  return NextResponse.json({
    syncStatus: error ? null : data?.discord_sync_status ?? null,
  });
}
