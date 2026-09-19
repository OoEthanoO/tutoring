import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { notifyFounders } from "@/lib/notificationsServer";
import { escapeEnrollmentEmailHtml } from "@/lib/enrollmentRequests";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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
    .select("id, title, max_students, course_classes(starts_at), course_enrollments(count)")
    .eq("id", courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const maxStudents = course.max_students;
  if (typeof maxStudents === "number" && maxStudents > 0) {
    const currentEnrollmentCount = course.course_enrollments?.[0]?.count ?? 0;
    if (currentEnrollmentCount >= maxStudents) {
      return NextResponse.json(
        { error: "Course is full." },
        { status: 400 }
      );
    }
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

  const { data: existingEnrollment, error: enrollmentLookupError } = await adminClient
    .from("course_enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (enrollmentLookupError) {
    return NextResponse.json({ error: "Unable to check existing enrollment. Please try again." }, { status: 500 });
  }

  if (existingEnrollment) {
    return NextResponse.json(
      { error: "Already enrolled in this course." },
      { status: 400 }
    );
  }

  const { data: existingRequest, error: requestLookupError } = await adminClient
    .from("course_enrollment_requests")
    .select("id, status, created_at")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (requestLookupError) {
    return NextResponse.json({ error: "Unable to check your enrollment request. Please try again." }, { status: 500 });
  }
  // Rejected applicants of every role may reapply. Approved requests can also
  // outlive a manually removed enrollment. Do not erase either before the new
  // application has been validated and saved.
  if (existingRequest && !["rejected", "approved"].includes(existingRequest.status)) {
    return NextResponse.json(
      { error: `Enrollment request already ${existingRequest.status}.` },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    guardianEmail?: string;
    studentFullName?: string;
    schoolName?: string;
    grade?: string;
    parentGuardianName?: string;
    parentGuardianPhone?: string;
    consentName?: string;
  } | null;

  if (
    !body || ![body.guardianEmail, body.studentFullName, body.schoolName, body.grade,
      body.parentGuardianName, body.parentGuardianPhone, body.consentName]
      .every(value => typeof value === "string" && value.trim())
  ) {
    return NextResponse.json(
      { error: "Missing application details." },
      { status: 400 }
    );
  }

  // Update user profile (grade and school)
  const { error: userUpdateError } = await adminClient
    .from("app_users")
    .update({
      grade: body.grade,
      school: body.schoolName,
    })
    .eq("id", user.id);

  if (userUpdateError) {
    return NextResponse.json(
      { error: "Failed to update user profile." },
      { status: 500 }
    );
  }

  // Save specific application details
  const { error: applicationError } = await adminClient
    .from("student_applications")
    .insert({
      course_id: courseId,
      student_id: user.id,
      guardian_email: body.guardianEmail,
      student_full_name: body.studentFullName,
      school_name: body.schoolName,
      grade: body.grade,
      parent_guardian_name: body.parentGuardianName,
      parent_guardian_phone: body.parentGuardianPhone,
      consent_name: body.consentName,
    });

  if (applicationError) {
    return NextResponse.json(
      { error: "Failed to save application details." },
      { status: 500 }
    );
  }

  const studentName =
    String(user.full_name ?? "").trim() || user.email || "Unnamed student";

  const requestValues = {
    course_id: courseId,
    student_id: user.id,
    student_name: studentName,
    student_email: user.email ?? null,
    status: "pending",
  };
  const writeRequest = existingRequest
    ? adminClient.from("course_enrollment_requests")
      .update({ ...requestValues, rejection_reason: null, decided_at: null, created_at: new Date().toISOString() })
      .eq("id", existingRequest.id)
      .eq("status", existingRequest.status)
      .eq("created_at", existingRequest.created_at)
    : adminClient.from("course_enrollment_requests").insert(requestValues);
  const { data: requestData, error: requestError } = await writeRequest
    .select("id, course_id, student_id, status, created_at")
    .maybeSingle();

  if (requestError || !requestData) {
    return NextResponse.json(
      { error: requestError?.message ?? "Your enrollment request changed. Refresh and try again." },
      { status: requestError ? 500 : 409 }
    );
  }

  const courseTitle = course?.title ?? "a course";
  const subject = "New enrollment request submitted";
  const html = `<p>${escapeEnrollmentEmailHtml(studentName)} requested enrollment in <strong>${escapeEnrollmentEmailHtml(courseTitle)}</strong>.</p>`;
  
  await notifyFounders(subject, html);

  return NextResponse.json({ request: requestData });
}
