import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, isExecutive, isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import {
  notifyFounders,
  sendDiscordMessageByChannelName,
  getDiscordRoleIdByName,
  foundersChannelName,
} from "@/lib/notificationsServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CourseRequestUpdatePayload = {
  status: string;
  title?: string;
  description?: string;
  timeframes?: Record<string, string>;
  frequency?: string;
  notes?: string;
  total_classes?: number;
  start_date?: string;
  is_co_taught?: boolean;
  co_tutor_id?: string | null;
};

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
    isCoTaught?: boolean;
    coTutorId?: string | null;
  } | null;

  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const timeframes = body?.timeframes ?? {};
  const frequency = body?.frequency?.trim() ?? "";
  const notes = body?.notes?.trim() ?? "";
  const totalClasses = typeof body?.totalClasses === "number" ? body.totalClasses : 1;
  const startDate = body?.startDate?.trim() || new Date().toISOString().split('T')[0];
  const isCoTaught = !!body?.isCoTaught;
  const coTutorId = body?.coTutorId || null;

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
      is_co_taught: isCoTaught,
      co_tutor_id: coTutorId,
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
  await notifyFounders("New Course Request Submission", emailHtml).catch((err) => {
    console.error("Failed to send founder emails:", err);
  });

  // Send Discord message to founders channel (best-effort, non-blocking)
  const cooRoleId = await getDiscordRoleIdByName("COO");
  const founderMention = cooRoleId ? `<@&${cooRoleId}>` : "@COO";
  const discordMessage = `${founderMention} New course request: **${title}** from ${user.full_name} (${user.email})`;
  await sendDiscordMessageByChannelName(foundersChannelName(), discordMessage).catch((err) => {
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
    .select("id, title, description, timeframes, frequency, notes, rejection_reason, total_classes, start_date, status, created_by, created_at, decided_at, decided_by, is_co_taught, co_tutor_id, app_users!course_creation_requests_created_by_fkey(full_name, email), co_tutor:app_users!course_creation_requests_co_tutor_id_fkey(full_name, email)")
    .order("created_at", { ascending: false });

  if (!isFounder(role)) {
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
    status?: string;
    isCoTaught?: boolean;
    coTutorId?: string | null;
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

  const role = resolveUserRole(user.email, user.role ?? null);

  // Verify the user owns this request or is a founder
  const { data: existing } = await adminClient
    .from("course_creation_requests")
    .select("created_by, status, title")
    .eq("id", requestId)
    .maybeSingle();

  if (!existing || (existing.created_by !== user.id && !isExecutive(role))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // If status is "rejected", change it to "draft" on edit (unless admin overrides explicitly)
  let newStatus = existing.status === "rejected" ? "draft" : existing.status;
  
  // Admins can explicitly set any status
  if (isExecutive(role) && body?.status) {
    newStatus = body.status;
  } else if (body?.status === "in_review" && (existing.status === "draft" || existing.status === "rejected")) {
    // Normal users can only resubmit
    newStatus = "in_review";
  }

  const updatePayload: CourseRequestUpdatePayload = { status: newStatus };

  if (body?.title !== undefined) updatePayload.title = body.title.trim();
  if (body?.description !== undefined) updatePayload.description = body.description.trim();
  if (body?.timeframes !== undefined) updatePayload.timeframes = body.timeframes;
  if (body?.frequency !== undefined) updatePayload.frequency = body.frequency.trim();
  if (body?.notes !== undefined) updatePayload.notes = body.notes.trim();
  if (body?.totalClasses !== undefined) updatePayload.total_classes = body.totalClasses;
  if (body?.startDate !== undefined) updatePayload.start_date = body.startDate.trim();
  if (body?.isCoTaught !== undefined) updatePayload.is_co_taught = body.isCoTaught;
  if (body?.coTutorId !== undefined) updatePayload.co_tutor_id = body.coTutorId;

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

  // If status changed to in_review (e.g. resubmission), notify founders
  if (newStatus === "in_review" && existing.status !== "in_review") {
    const courseTitle = body?.title || existing.title || "Unknown Course";
    
    const cooRoleId = await getDiscordRoleIdByName("COO");
    const founderMention = cooRoleId ? `<@&${cooRoleId}>` : "@COO";
    const discordMessage = `${founderMention} Course request resubmitted: **${courseTitle}** by ${user.full_name} (${user.email})`;
    await sendDiscordMessageByChannelName(foundersChannelName(), discordMessage).catch((err) => {
      console.error("Failed to send Discord message:", err);
    });

    const emailHtml = `
      <h1>Course Request Resubmitted</h1>
      <p><strong>${user.full_name}</strong> (${user.email}) has resubmitted their course request.</p>
      <p><strong>Title:</strong> ${courseTitle}</p>
      <p>Please review it in the founders dashboard.</p>
    `;
    await notifyFounders("Course Request Resubmitted", emailHtml).catch((err) => {
      console.error("Failed to send founder emails:", err);
    });
  }

  return NextResponse.json({ success: true });
}
