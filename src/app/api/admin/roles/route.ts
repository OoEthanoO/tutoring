import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { getAdminClient } from "@/lib/authServer";
import { resolveUserRole, isFounder } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((value): value is string => Boolean(value));

  const role = resolveUserRole(user.email, user.role, customRoleLevels);
  if (!isFounder(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.from("custom_roles").select("*").order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ roles: data || [] });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((value): value is string => Boolean(value));

  const role = resolveUserRole(user.email, user.role, customRoleLevels);
  if (!isFounder(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, role_level } = body;
  if (!name || !role_level) {
    return NextResponse.json({ error: "Missing name or role_level" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.from("custom_roles").insert({ name, role_level }).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ role: data[0] });
}
