import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!isFounder(role)) {
    return NextResponse.json({ error: "Only founders can perform this action." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const targetEmail = body?.email?.trim();

  if (!targetEmail) {
    return NextResponse.json({ error: "Missing target email address." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Find the target user by email
  const { data: targetUser, error: findError } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role")
    .eq("email", targetEmail)
    .maybeSingle();

  if (findError || !targetUser) {
    return NextResponse.json(
      { error: "User with this email not found." },
      { status: 404 }
    );
  }

  if (resolveUserRole(targetUser.email, targetUser.role ?? null) === "student") {
    return NextResponse.json(
      { error: "Cannot assign limbo courses to a student." },
      { status: 400 }
    );
  }

  // Perform bulk update on courses where created_by is null
  const { error: updateError } = await adminClient
    .from("courses")
    .update({
      created_by: targetUser.id,
      created_by_name: String(targetUser.full_name ?? "").trim() || targetUser.email || null,
      created_by_email: targetUser.email,
    })
    .is("created_by", null);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to update limbo courses." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
