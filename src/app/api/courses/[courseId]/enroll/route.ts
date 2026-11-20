import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { escapeEnrollmentEmailHtml } from "@/lib/enrollmentRequests";
import { notifyFounders, sendEmail, sendDiscordMessageByChannelName, executivesChannelName } from "@/lib/notificationsServer";
import { formatPaidFee, paidCourseBlocker } from "@/lib/paidCourses";
import { loadPaidCourseTutors } from "@/lib/paidCoursesServer";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(
  request: NextRequest,
  { params }: { params: { courseId: string } | Promise<{ courseId: string }> }
) {
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
    .select("id, title, max_students, is_paid, paid_fee, created_by, is_co_taught, co_tutor_id, course_classes(starts_at), course_enrollments(count)")
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

  // A paid course is paid straight to its tutor. Without a senior tutor and
  // their payment note there is nobody to pay, so the course is not open.
  if (course.is_paid) {
    let blocker: string | null;
    try {
      const tutors = await loadPaidCourseTutors(adminClient, [course.created_by, course.co_tutor_id]);
      blocker = paidCourseBlocker({
        owner: course.created_by ? tutors.get(course.created_by) ?? null : null,
        coTutor: course.is_co_taught && course.co_tutor_id
          ? tutors.get(course.co_tutor_id) ?? { seniorTutor: false }
          : null,
        fee: course.paid_fee,
      });
    } catch {
      return NextResponse.json({ error: "Unable to check this course. Please try again." }, { status: 503 });
    }
    if (blocker) {
      return NextResponse.json(
        { error: "Enrollment for this paid course is not open yet. Please check back later." },
        { status: 400 }
      );
    }
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
      // A new application is a new payment to confirm, so the old tick goes.
      .update({ ...requestValues, rejection_reason: null, decided_at: null, created_at: new Date().toISOString(), payment_confirmed_at: null, payment_confirmed_by: null })
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

  // The tutor of a paid course has to mark the payment as received before
  // management can approve, so they hear about the request too. The family's
  // names go by email only; the Discord ping carries none.
  if (course.is_paid && course.created_by) {
    try {
      const { data: tutor } = await adminClient
        .from("app_users")
        .select("email, full_name, discord_user_id")
        .eq("id", course.created_by)
        .maybeSingle();
      const guardianName = String(body.parentGuardianName ?? "").trim();
      if (tutor?.email) {
        await sendEmail(
          tutor.email,
          `Payment to confirm: ${courseTitle}`,
          `<p>${escapeEnrollmentEmailHtml(String(body.studentFullName ?? studentName).trim())} has asked to enroll in your paid course <strong>${escapeEnrollmentEmailHtml(courseTitle)}</strong>.</p>
           <p>Parent or guardian: ${escapeEnrollmentEmailHtml(guardianName || "not given")}<br>Course fee: ${formatPaidFee(course.paid_fee)}</p>
           <p>When the payment has arrived in your account, open Teaching &gt; My courses on YanLearn and press <strong>Payment received</strong>. Management can approve the enrollment only after that. Do not press it before the money has arrived.</p>`
        );
      }
      if (tutor?.discord_user_id) {
        await sendDiscordMessageByChannelName(
          executivesChannelName(),
          `<@${tutor.discord_user_id}> A family has asked to enroll in your paid course **${courseTitle}**. When their payment arrives, press **Payment received** in My courses so that management can approve the enrollment.`,
          undefined,
          [tutor.discord_user_id]
        );
      }
    } catch (error) {
      console.error("Failed to tell the tutor about a paid enrollment request:", error);
    }
  }

  return NextResponse.json({ request: requestData });
}
