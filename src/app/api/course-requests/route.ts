import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { notifyFounders, sendDiscordMessageByChannelName } from "@/lib/notificationsServer";

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
      status: "in_review",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create request." },
      { status: 500 }
    );
  }

  // Notify founders via email and Discord
  const requestLink = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/`;
  const emailHtml = `
    <h2>New Course Request Submitted</h2>
    <p><strong>Title:</strong> ${title}</p>
    <p><strong>Submitted by:</strong> ${user.full_name} (${user.email})</p>
    <p><strong>Description:</strong></p>
    <p>${description || "(No description provided)"}</p>
    <p><strong>Frequency:</strong> ${frequency || "(Not specified)"}</p>
    <p><strong>Total Classes:</strong> ${totalClasses}</p>
    <p><strong>Start Date:</strong> ${startDate}</p>
    ${notes ? `<p><strong>Notes:</strong></p><p>${notes}</p>` : ""}
    <p><a href="${requestLink}">View in YanLearn</a></p>
  `;

  // Send emails sequentially to all founders (best-effort, non-blocking)
  notifyFounders("New Course Request Submission", emailHtml).catch((err) => {
    console.error("Failed to send founder emails:", err);
  });

  // Send Discord message to founders channel (best-effort, non-blocking)
  const discordMessage = `@founders New course request: **${title}** from ${user.full_name} (${user.email})`;
  sendDiscordMessageByChannelName("founders", discordMessage).catch((err) => {
    console.error("Failed to send Discord message:", err);
  });

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

export async function PATCH(request: NextRequest) {
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

  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    title?: string;
    description?: string;
    timeframes?: Record<string, string>;
    frequency?: string;
    notes?: string;
    totalClasses?: number;
    startDate?: string;
  } | null;

  const requestId = body?.requestId;
  if (!requestId) {
    return NextResponse.json(
      { error: "Request ID is required." },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Verify the user owns this request
  const { data: existing } = await adminClient
    .from("course_creation_requests")
    .select("created_by, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!existing || existing.created_by !== user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // If status is "rejected", change it to "draft" on edit
  const newStatus = existing.status === "rejected" ? "draft" : existing.status;

  const updatePayload: Record<string, any> = { status: newStatus };

  if (body?.title !== undefined) updatePayload.title = body.title.trim();
  if (body?.description !== undefined) updatePayload.description = body.description.trim();
  if (body?.timeframes !== undefined) updatePayload.timeframes = body.timeframes;
  if (body?.frequency !== undefined) updatePayload.frequency = body.frequency.trim();
  if (body?.notes !== undefined) updatePayload.notes = body.notes.trim();
  if (body?.totalClasses !== undefined) updatePayload.total_classes = body.totalClasses;
  if (body?.startDate !== undefined) updatePayload.start_date = body.startDate.trim();

  const { error: updateError } = await adminClient
    .from("course_creation_requests")
    .update(updatePayload)
    .eq("id", requestId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to update request." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
