import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { resolveUserRole, isHighRankingChiefExecutive } from "@/lib/roles";

export async function GET() {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("site_settings")
    .select("contact_email")
    .eq("id", true)
    .single();

  if (error || !data || !data.contact_email) {
    return NextResponse.json({ contact_email: "ethanxucoder@gmail.com" });
  }

  return NextResponse.json({ contact_email: data.contact_email });
}

export async function PUT(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));

  const role = resolveUserRole(user.email, user.role, customRoleLevels);
  if (!isHighRankingChiefExecutive(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { contact_email } = await request.json();
    if (!contact_email || typeof contact_email !== "string" || !contact_email.includes("@")) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { error } = await supabase
      .from("site_settings")
      .update({ contact_email })
      .eq("id", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, contact_email });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
