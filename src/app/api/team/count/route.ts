import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTeamCount } from "@/lib/teamRoster";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Public: the home page shows the team size to signed-out visitors, so this
// returns a count only — never any user details.
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
    const count = await fetchTeamCount(adminClient);
    return NextResponse.json({ count });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load team." },
      { status: 500 }
    );
  }
}
