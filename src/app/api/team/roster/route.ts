import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTeamRoster } from "@/lib/teamRoster";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Public: the Our team tab shows the roster to signed-out visitors, so this
// returns display fields only — never emails or other personal details.
export async function GET() {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const members = await fetchTeamRoster(adminClient);
    return NextResponse.json({ members });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load team." },
      { status: 500 }
    );
  }
}
