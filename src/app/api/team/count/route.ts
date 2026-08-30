import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { countTeamMembers } from "@/lib/teamRoster";

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

  const [usersResult, coursesResult] = await Promise.all([
    adminClient.from("app_users").select("id, role, custom_role, is_junior"),
    adminClient.from("courses").select("created_by"),
  ]);

  if (usersResult.error || !usersResult.data) {
    return NextResponse.json(
      { error: usersResult.error?.message ?? "Failed to load team." },
      { status: 500 }
    );
  }

  if (coursesResult.error || !coursesResult.data) {
    return NextResponse.json(
      { error: coursesResult.error?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  const activeCreatorIds = new Set(
    coursesResult.data
      .map((course) => course.created_by)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const count = countTeamMembers(
    usersResult.data.map((user) => ({
      id: user.id as string,
      role: user.role ?? null,
      customRole: user.custom_role ?? null,
      isJunior: user.is_junior ?? null,
    })),
    activeCreatorIds
  );

  return NextResponse.json({ count });
}
