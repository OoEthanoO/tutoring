import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { sendEmail, sendDiscordMessageByChannelName } from "@/lib/notificationsServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  
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
  if (role !== "founder") {
    return NextResponse.json({ error: "Forbidden. Only founders can reject." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }
  const body = (await request.json().catch(() => null)) as { note?: string } | null;

  if (!body?.note || !body.note.trim()) {
    return NextResponse.json({ error: "Rejection note is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: requestRecord, error: reqError } = await adminClient
    .from("course_creation_requests")
    .select("*, app_users!course_creation_requests_created_by_fkey(full_name, email, discord_user_id)")
    .eq("id", requestId)
    .single();

  if (reqError || !requestRecord) {
    return NextResponse.json({ error: reqError?.message ?? "Request not found." }, { status: 404 });
  }

  if (!(requestRecord.status === "in_review" || requestRecord.status === "pending")) {
    return NextResponse.json({ error: "Request is not in review." }, { status: 400 });
  }

  const note = body.note.trim();

  const { error: updateError } = await adminClient
    .from("course_creation_requests")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      rejection_reason: note,
    })
    .eq("id", requestId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to reject request." },
      { status: 500 }
    );
  }

  // Send notification to the executive who created the request
  (async () => {
    try {
      const execUser = Array.isArray(requestRecord.app_users)
        ? requestRecord.app_users[0]
        : requestRecord.app_users;

      const execEmail = execUser?.email;
      const execDiscordId = execUser?.discord_user_id;
      const requesterName = execUser?.full_name || execUser?.email || "Tutor";

      if (execEmail) {
        const emailSubject = `Course Request Rejected: ${requestRecord.title}`;
        const emailHtml = `
          <h1>Your Course Request was Rejected</h1>
          <p>Hi ${requesterName},</p>
          <p>Your course request for <strong>${requestRecord.title}</strong> has been rejected.</p>
          <h2>Reason</h2>
          <p>${note}</p>
          <p>If you'd like to revise and resubmit, please go back on the website, edit the course request, and resubmit.</p>
        `;

        await sendEmail(execEmail, emailSubject, emailHtml);
      }

      const discordMention = execDiscordId ? `<@${execDiscordId}>` : `**${requesterName}**`;
      const discordContent = `${discordMention} Your course request for **${requestRecord.title}** was rejected.

Reason: ${note}

If you'd like to revise and resubmit, please go back on the website, edit the course request, and resubmit.`;
      await sendDiscordMessageByChannelName("executives", discordContent);
    } catch (err) {
      console.error("Failed to send rejection notifications:", err);
    }
  })();

  return NextResponse.json({ success: true });
}
