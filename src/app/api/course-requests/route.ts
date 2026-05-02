import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
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
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    description?: string;
    timeframes?: Record<string, string>;
    frequency?: string;
    notes?: string;
    totalClasses?: number;
    startDate?: string;
  } | null;

  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const timeframes = body?.timeframes ?? {};
  const frequency = body?.frequency?.trim() ?? "";
  const notes = body?.notes?.trim() ?? "";
  const totalClasses = typeof body?.totalClasses === "number" ? body.totalClasses : 1;
  const startDate = body?.startDate?.trim() || new Date().toISOString().split('T')[0];

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await adminClient
    .from("course_creation_requests")
    .insert({
      title,
      description,
      timeframes,
      frequency,
      notes,
      total_classes: totalClasses,
      start_date: startDate,
      created_by: user.id,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create request." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, request: data });
}

export async function GET(request: NextRequest) {
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

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const role = resolveUserRole(user.email, user.role ?? null);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let query = adminClient
    .from("course_creation_requests")
    .select("id, title, description, timeframes, frequency, notes, total_classes, start_date, status, created_by, created_at, decided_at, decided_by, app_users!course_creation_requests_created_by_fkey(full_name, email)")
    .order("created_at", { ascending: false });

  if (role !== "founder") {
    query = query.eq("created_by", user.id);
  }

  const { data, error } = await query;

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to list requests." },
      { status: 500 }
    );
  }

  return NextResponse.json({ requests: data });
}
