import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { getAdminClient } from "@/lib/authServer";
import { resolveUserRole, isFounder, resolveAccountRole, canAssignRole, leadershipProtectionMessage } from "@/lib/roles";

const roleLevels = ["CEO", "COO", "CEO Shadow", "COO Shadow", "Chief Executive", "Executive", "Student"];

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
  return NextResponse.json({
    roles: data || [],
    allowedRoleLevels: roleLevels.filter((level) => canAssignRole(role, resolveUserRole(null, level))),
  });
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
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role_level = typeof body?.role_level === "string" ? body.role_level.trim() : "";
  if (!name || name.length > 100 || !roleLevels.includes(role_level)) {
    return NextResponse.json({ error: "Missing name or role_level" }, { status: 400 });
  }

  const requestedRole = resolveAccountRole({ custom_role: name, custom_roles: { role_level } });
  if (!canAssignRole(role, requestedRole)) {
    return NextResponse.json({ error: leadershipProtectionMessage }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.from("custom_roles").insert({ name, role_level }).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ role: data[0] });
}
