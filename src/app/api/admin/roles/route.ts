import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { getAdminClient } from "@/lib/authServer";

export async function GET(request: Request) {
  const user = await getRequestUser(request as any);
  if (!user || user.email !== "ethanyanxu@icloud.com") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.from("custom_roles").select("*").order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ roles: data || [] });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request as any);
  if (!user || user.email !== "ethanyanxu@icloud.com") {
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
