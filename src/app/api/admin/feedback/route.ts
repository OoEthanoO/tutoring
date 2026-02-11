import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await adminClient
    .from("feedback_submissions")
    .select(
      "id, user_id, user_email, user_name, contact_email, message, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to load feedback." },
      { status: 500 }
    );
  }

  const feedback = (data ?? []).map((entry) => ({
    id: entry.id,
    userId: entry.user_id,
    userEmail: entry.user_email,
    userName: entry.user_name,
    contactEmail: entry.contact_email,
    message: entry.message,
    status: entry.status,
    createdAt: entry.created_at,
  }));

  return NextResponse.json({ feedback });
}

export async function DELETE(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { feedbackId?: string }
    | null;
  const feedbackId = body?.feedbackId?.trim() ?? "";
  if (!feedbackId) {
    return NextResponse.json({ error: "Missing feedbackId." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await adminClient
    .from("feedback_submissions")
    .delete()
    .eq("id", feedbackId);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to delete feedback." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
