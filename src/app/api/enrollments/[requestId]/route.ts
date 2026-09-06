import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { classOnSchoolhouse } from "@/lib/discordLiveChannels";
import { getRequestUser } from "@/lib/authServer";
import { notifyCourseTutorsOfNewEnrollment } from "@/lib/courseChangeNotifications";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";

type Action = "approve" | "reject" | "expand_and_approve";

type EnrollmentRequestCourse = {
  id: string;
  title: string | null;
  short_name: string | null;
  created_by_name: string | null;
  created_by: string | null;
  created_by_email: string | null;
  max_students: number | null;
  course_enrollments: { count: number }[] | null;
};

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!resendApiKey || !resendFrom) {
    return;
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to,
      subject,
      html,
    }),
  });
};

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: { requestId: string } | Promise<{ requestId: string }>;
  }
) {
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const requestId = resolvedParams?.requestId ?? "";
  if (!requestId) {
    return NextResponse.json({ error: "Missing request id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: Action }
    | null;

  const action = body?.action;
  if (action !== "approve" && action !== "reject" && action !== "expand_and_approve") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: requestData, error: requestError } = await adminClient
    .from("course_enrollment_requests")
    .select(
      "id, course_id, student_id, student_name, student_email, status, course:courses(id, title, short_name, created_by_name, created_by, created_by_email, max_students, course_enrollments(count))"
    )
    .eq("id", requestId)
    .single();

  if (requestError || !requestData) {
    return NextResponse.json(
      { error: requestError?.message ?? "Request not found." },
      { status: 404 }
    );
  }

  const isPending = requestData.status === "pending";
  const isRejectedButApproving = requestData.status === "rejected" && (action === "approve" || action === "expand_and_approve");

  if (!isPending && !isRejectedButApproving) {
    return NextResponse.json(
      { error: "Request already processed." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  if (action === "approve" || action === "expand_and_approve") {
    const course: EnrollmentRequestCourse | null | undefined = Array.isArray(requestData.course)
      ? requestData.course[0]
      : requestData.course;
    const maxStudents = course?.max_students;
    const enrollmentCount = course?.course_enrollments?.[0]?.count ?? 0;
    const courseId = course?.id;

    if (action === "approve" && maxStudents && enrollmentCount >= maxStudents) {
      return NextResponse.json(
        { error: "Course is already full." },
        { status: 400 }
      );
    }

    if (action === "expand_and_approve" && maxStudents && courseId) {
      await adminClient
        .from("courses")
        .update({ max_students: maxStudents + 1 })
        .eq("id", courseId);
    }

    await adminClient
      .from("course_enrollments")
      .upsert(
        {
          course_id: requestData.course_id,
          student_id: requestData.student_id,
          student_name: requestData.student_name,
          student_email: requestData.student_email,
        },
        { onConflict: "course_id,student_id" }
      );

    await notifyCourseTutorsOfNewEnrollment(
      adminClient,
      requestData.course_id,
      String(requestData.student_name ?? "").trim(),
      requestData.student_email ?? null
    );
  }


  const { data: updatedRequest, error: updateError } = await adminClient
    .from("course_enrollment_requests")
    .update({
      status: (action === "approve" || action === "expand_and_approve") ? "approved" : "rejected",
      decided_at: now,
    })
    .eq("id", requestId)
    .select("id, status, decided_at")
    .single();

  if (updateError || !updatedRequest) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update request." },
      { status: 500 }
    );
  }

  const studentEmail = requestData.student_email ?? "";
  const courseTitle =
    Array.isArray(requestData.course)
      ? requestData.course[0]?.title ?? "course"
      : (requestData.course as { title?: string } | null)?.title ?? "course";
  const tutorId = Array.isArray(requestData.course)
    ? requestData.course[0]?.created_by
    : (requestData.course as { created_by?: string } | null)?.created_by;

  await adminClient
    .from("tutor_profiles")
    .select("donation_link")
    .eq("user_id", tutorId)
    .maybeSingle();

  let isSchoolhouseCourse = false;
  const tutorEmail = Array.isArray(requestData.course)
    ? requestData.course[0]?.created_by_email
    : (requestData.course as { created_by_email?: string } | null)?.created_by_email;

  if (tutorEmail && isFounder(resolveUserRole(tutorEmail, null))) {
    // Founder-taught courses ran on Schoolhouse; from the migration date their
    // classes are in Discord like everyone else's. What matters to a student
    // being approved now is where the classes they are about to attend happen,
    // so this asks about the next one rather than the course's first — a course
    // already under way moves over partway through.
    const { data: nextClass } = await adminClient
      .from("course_classes")
      .select("starts_at")
      .eq("course_id", requestData.course_id)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    isSchoolhouseCourse = classOnSchoolhouse({
      founderTaught: true,
      classStart: nextClass?.starts_at ? new Date(String(nextClass.starts_at)) : new Date(),
    });
  }

  let hasDiscordConnected = false;
  if (requestData.student_id) {
    const { data: studentUser } = await adminClient
      .from("app_users")
      .select("discord_user_id")
      .eq("id", requestData.student_id)
      .maybeSingle();
    
    if (studentUser?.discord_user_id) {
      hasDiscordConnected = true;
    }
  }

  if (studentEmail) {
    const isApproval = action === "approve" || action === "expand_and_approve";
    const subject = isApproval
        ? `Enrollment approved: ${courseTitle}`
        : `Enrollment update: ${courseTitle}`;
    const html = isApproval
        ? `<p>Your enrollment request for <strong>${courseTitle}</strong> has been approved.</p>
           <p>Please attend the class 5 minutes before the start time:</p>
           ${isSchoolhouseCourse ? 
             `<p>This course is hosted on Schoolhouse! Please join the session via the Schoolhouse platform. If you don't have a Schoolhouse account yet, please create one using this link: <a href="https://schoolhouse.world/?ref=u-mx1o1c1hti">https://schoolhouse.world/?ref=u-mx1o1c1hti</a></p>` 
             : 
             `<p>This class will be held on <strong>Discord</strong>. Please make sure you have connected your Discord account in your profile and joined our Discord server.</p>
              ${!hasDiscordConnected ? `<p style="color: red; font-weight: bold;">⚠️ Action Required: You have not connected your Discord account yet! You will NOT be able to attend classes until you do so.</p>
              <p style="color: red;">To connect your Discord account:</p>
              <ol style="color: red;">
                <li>Go to your Profile on our website.</li>
                <li>Click the "Connect Discord" button.</li>
                <li>Authorize your account and you will be redirected to join our Discord server.</li>
              </ol>` : ""}
              <p>You will receive a notification in the Discord server with a link to the voice channel 5 minutes before the class starts. Please make sure to join the server if you haven't already.</p>`
           }`
        : `<p>Your enrollment request for <strong>${courseTitle}</strong> has been rejected.</p>`;

    await sendEmail(studentEmail, subject, html);
  }

  return NextResponse.json({ request: updatedRequest });
}
