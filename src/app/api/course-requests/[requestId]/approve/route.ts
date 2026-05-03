import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { relabelClassesForCourse } from "@/lib/classTools";
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
    return NextResponse.json({ error: "Forbidden. Only founders can approve." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    classes?: { title?: string; startsAt?: string; durationHours?: number }[];
    maxStudents?: number | null;
  } | null;

  const classes = Array.isArray(body?.classes) ? body?.classes ?? [] : [];
  const maxStudents =
    typeof body?.maxStudents === "number" && body.maxStudents > 0
      ? Math.floor(body.maxStudents)
      : null;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: requestRecord, error: reqError } = await adminClient
    .from("course_creation_requests")
    .select("*, app_users!course_creation_requests_created_by_fkey(full_name, email, discord_user_id)")
    .eq("id", requestId)
    .single();

  if (reqError || !requestRecord) {
    return NextResponse.json(
      { error: reqError?.message ?? "Request not found." },
      { status: 404 }
    );
  }

  if (!(requestRecord.status === "in_review" || requestRecord.status === "pending")) {
    return NextResponse.json(
      { error: "Request is not in review." },
      { status: 400 }
    );
  }

  const creatorUser = Array.isArray(requestRecord.app_users) 
    ? requestRecord.app_users[0] 
    : requestRecord.app_users;

  const creatorName = creatorUser?.full_name?.trim() || creatorUser?.email || "Unknown tutor";

  // Create the course
  const { data: courseData, error: courseError } = await adminClient
    .from("courses")
    .insert({
      title: requestRecord.title,
      description: requestRecord.description,
      is_completed: false,
      max_students: maxStudents,
      created_by: requestRecord.created_by,
      created_by_name: creatorName,
      created_by_email: creatorUser?.email ?? null,
    })
    .select("id")
    .single();

  if (courseError || !courseData) {
    return NextResponse.json(
      { error: courseError?.message ?? "Failed to create course." },
      { status: 500 }
    );
  }

  // Create classes if provided
  const classRows = classes
    .map((item) => ({
      title: item?.title?.trim() ?? "",
      startsAt: item?.startsAt?.trim() ?? "",
      durationHours: typeof item?.durationHours === "number" ? item.durationHours : 1,
    }))
    .filter((item) => item.title && item.startsAt);

  if (classRows.length > 0) {
    const { error: classError } = await adminClient
      .from("course_classes")
      .insert(
        classRows.map((item) => ({
          course_id: courseData.id,
          title: item.title,
          starts_at: item.startsAt,
          duration_hours: item.durationHours,
          created_by: requestRecord.created_by,
        }))
      );

    if (classError) {
      // It failed partially, but course is created. Let user handle missing classes manually.
      console.error("Failed to add classes to course", courseData.id, classError);
    } else {
      await relabelClassesForCourse(courseData.id, adminClient);
    }
  }

  // Mark request as approved
  const { error: updateError } = await adminClient
    .from("course_creation_requests")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq("id", requestId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Course created, but failed to update request status." },
      { status: 500 }
    );
  }

  // Send notifications
  (async () => {
    try {
      const execUser = Array.isArray(requestRecord.app_users) ? requestRecord.app_users[0] : requestRecord.app_users;
      const execEmail = execUser?.email;
      const execDiscordId = execUser?.discord_user_id;

      console.log(`Notification debug: execEmail=${execEmail}, execDiscordId=${execDiscordId}`);

      if (!execEmail) return;

      const courseTitle = requestRecord.title;
      const classDetails = classRows.map((c, i) => 
        `Class ${i + 1}: ${new Date(c.startsAt).toLocaleString('en-US', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${c.durationHours}h)`
      ).join('\n');

      const emailSubject = `Course Request Approved: ${courseTitle}`;
      const emailHtml = `
        <h1>Your Course Request has been Approved!</h1>
        <p>Hi ${execUser.full_name || 'there'},</p>
        <p>Your request for the course <strong>${courseTitle}</strong> has been approved and finalized.</p>
        <h2>Course Details</h2>
        <p><strong>Title:</strong> ${courseTitle}</p>
        <p><strong>Max Students:</strong> ${maxStudents || 'Unlimited'}</p>
        <h3>Finalized Classes:</h3>
        <pre>${classDetails || 'No classes scheduled yet.'}</pre>
        <p>Good luck with your course!</p>
      `;

      await sendEmail(execEmail, emailSubject, emailHtml);

      const discordMention = execDiscordId ? `<@${execDiscordId}>` : `**${execUser.full_name || execUser.email}**`;
      const discordContent = `${discordMention} Your course request for **${courseTitle}** has been approved!\n\n**Finalized Details:**\n- **Max Students:** ${maxStudents || 'Unlimited'}\n**Classes:**\n${classDetails || 'No classes scheduled.'}`;
      await sendDiscordMessageByChannelName("executives", discordContent);
    } catch (err) {
      console.error("Failed to send approval notifications:", err);
    }
  })();

  return NextResponse.json({ success: true, courseId: courseData.id });
}
