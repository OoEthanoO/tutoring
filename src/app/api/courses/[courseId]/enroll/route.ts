import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const founderEmail = process.env.NEXT_PUBLIC_FOUNDER_EMAIL ?? "";

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!resendApiKey || !resendFrom || !to) {
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

export async function POST(
  request: NextRequest,
  { params }: { params: { courseId: string } | Promise<{ courseId: string }> }
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

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const courseId = resolvedParams?.courseId ?? "";
  if (!courseId) {
    return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: course, error: courseError } = await adminClient
    .from("courses")
    .select("id, course_classes(starts_at)")
    .eq("id", courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const now = Date.now();
  const classStarts = (course.course_classes ?? [])
    .map((courseClass) => new Date(courseClass.starts_at).getTime())
    .filter((value) => Number.isFinite(value));
  const hasFutureClass = classStarts.some((startsAt) => startsAt > now);
  const enrollmentClosed = !hasFutureClass;

  if (enrollmentClosed) {
    return NextResponse.json(
      { error: "Enrollment for this course is closed." },
      { status: 400 }
    );
  }

  const { data: existingEnrollment } = await adminClient
    .from("course_enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (existingEnrollment) {
    return NextResponse.json(
      { error: "Already enrolled in this course." },
      { status: 400 }
    );
  }

  const { data: existingRequest } = await adminClient
    .from("course_enrollment_requests")
    .select("id, status")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (existingRequest) {
    if (existingRequest.status !== "rejected") {
      return NextResponse.json(
        { error: `Enrollment request already ${existingRequest.status}.` },
        { status: 400 }
      );
    }

    await adminClient
      .from("course_enrollment_requests")
      .delete()
      .eq("id", existingRequest.id);
  }

  const studentName =
    String(user.full_name ?? "").trim() || user.email || "Unnamed student";

  const { data: requestData, error: requestError } = await adminClient
    .from("course_enrollment_requests")
    .insert({
      course_id: courseId,
      student_id: user.id,
      student_name: studentName,
      student_email: user.email ?? null,
      status: "pending",
    })
    .select("id, course_id, student_id, status, created_at")
    .single();

  if (requestError || !requestData) {
    return NextResponse.json(
      { error: requestError?.message ?? "Failed to create request." },
      { status: 500 }
    );
  }

  if (founderEmail) {
    const { data: courseData } = await adminClient
      .from("courses")
      .select("title")
      .eq("id", courseId)
      .maybeSingle();

    const courseTitle = courseData?.title ?? "a course";
    const subject = "New enrollment request submitted";
    const html = `<p>${studentName} requested enrollment in <strong>${courseTitle}</strong>.</p>`;
    await sendEmail(founderEmail, subject, html);
  }

  return NextResponse.json({ request: requestData });
}
