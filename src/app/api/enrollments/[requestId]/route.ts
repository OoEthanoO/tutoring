import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const defaultZoomId = "822 9677 5321";
const defaultZoomPassword = "youth";

type Action = "approve" | "reject";

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

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
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
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: requestData, error: requestError } = await adminClient
    .from("course_enrollment_requests")
    .select(
      "id, course_id, student_id, student_name, student_email, status, course:courses(id, title, created_by_name)"
    )
    .eq("id", requestId)
    .single();

  if (requestError || !requestData) {
    return NextResponse.json(
      { error: requestError?.message ?? "Request not found." },
      { status: 404 }
    );
  }

  if (requestData.status !== "pending") {
    return NextResponse.json(
      { error: "Request already processed." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  if (action === "approve") {
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
  }

  const { data: updatedRequest, error: updateError } = await adminClient
    .from("course_enrollment_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
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
  const tutorName =
    Array.isArray(requestData.course)
      ? requestData.course[0]?.created_by_name ?? "your tutor"
      : (requestData.course as { created_by_name?: string } | null)
          ?.created_by_name ?? "your tutor";

  if (studentEmail) {
    const subject =
      action === "approve"
        ? `Enrollment approved: ${courseTitle}`
        : `Enrollment update: ${courseTitle}`;
    const html =
      action === "approve"
        ? `<p>Your enrollment request for <strong>${courseTitle}</strong> has been approved.</p>
           <p>Please attend the class 5 minutes before the start time:</p>
           <p>Zoom ID: ${defaultZoomId}<br/>Password: ${defaultZoomPassword}<br/>Breakout room: ${tutorName}</p>`
        : `<p>Your enrollment request for <strong>${courseTitle}</strong> has been rejected.</p>`;

    await sendEmail(studentEmail, subject, html);
  }

  return NextResponse.json({ request: updatedRequest });
}
