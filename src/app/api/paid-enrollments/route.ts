import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { uuidPattern } from "@/lib/classTrials";
import { escapeEnrollmentEmailHtml } from "@/lib/enrollmentRequests";
import { notifyFounders } from "@/lib/notificationsServer";
import { paymentConfirmationBlocker } from "@/lib/paidCourses";
import { isAllowedRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

/**
 * Enrollment requests waiting on a paid course's tutor (PAID_COURSES.md).
 *
 * Families pay the tutor of a paid course directly, so only that tutor knows
 * whether a payment has arrived. GET lists the pending requests on the
 * signed-in tutor's own paid courses; PATCH marks one as paid (or undoes
 * that). Management cannot approve the enrollment until it is marked.
 */

type PaidCourseRow = { id: string; title: string | null; paid_fee: number | string | null };
type PendingRequestRow = {
  id: string;
  course_id: string;
  student_id: string;
  student_name: string | null;
  created_at: string;
  payment_confirmed_at: string | null;
};
type ApplicationRow = {
  course_id: string;
  student_id: string;
  student_full_name: string | null;
  parent_guardian_name: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const { user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = getAdminClient();
  const { data: courses, error: coursesError } = await db
    .from("courses")
    .select("id, title, paid_fee")
    .eq("is_paid", true)
    .eq("created_by", user.id)
    .is("deleted_at", null);
  if (coursesError) {
    return NextResponse.json({ error: "Could not load your paid courses." }, { status: 503 });
  }

  const paidCourses = (courses ?? []) as PaidCourseRow[];
  if (paidCourses.length === 0) {
    return NextResponse.json({ requests: [] });
  }
  const courseIds = paidCourses.map((course) => course.id);

  const { data: pending, error: pendingError } = await db
    .from("course_enrollment_requests")
    .select("id, course_id, student_id, student_name, created_at, payment_confirmed_at")
    .in("course_id", courseIds)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (pendingError) {
    return NextResponse.json({ error: "Could not load enrollment requests." }, { status: 503 });
  }

  const requests = (pending ?? []) as PendingRequestRow[];
  const studentIds = Array.from(new Set(requests.map((item) => item.student_id)));

  // The newest application for each request: the names a transfer would carry.
  const { data: applications } = studentIds.length
    ? await db
      .from("student_applications")
      .select("course_id, student_id, student_full_name, parent_guardian_name, created_at")
      .in("course_id", courseIds)
      .in("student_id", studentIds)
      .order("created_at", { ascending: false })
    : { data: [] };

  const courseById = new Map(paidCourses.map((course) => [course.id, course]));
  return NextResponse.json({
    requests: requests.map((item) => {
      const application = ((applications ?? []) as ApplicationRow[]).find(
        (entry) => entry.course_id === item.course_id && entry.student_id === item.student_id
      );
      const course = courseById.get(item.course_id);
      return {
        id: item.id,
        courseId: item.course_id,
        courseTitle: course?.title ?? "Course",
        fee: course?.paid_fee === null || course?.paid_fee === undefined ? null : Number(course.paid_fee),
        studentName: application?.student_full_name || item.student_name || "Student",
        guardianName: application?.parent_guardian_name ?? null,
        submittedAt: item.created_at,
        paymentConfirmedAt: item.payment_confirmed_at,
      };
    }),
  });
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { user, isImpersonating } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Viewing the site as a tutor is not the tutor saying the money arrived.
  if (isImpersonating) {
    return NextResponse.json(
      { error: "Only the tutor can confirm a payment. Stop viewing as this account first." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { requestId?: unknown; received?: unknown; submittedAt?: unknown }
    | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!uuidPattern.test(requestId) || typeof body?.received !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const received = body.received;

  const db = getAdminClient();
  const { data: record, error: recordError } = await db
    .from("course_enrollment_requests")
    .select("id, status, created_at, student_name, payment_confirmed_at, course:courses(id, title, is_paid, created_by, deleted_at)")
    .eq("id", requestId)
    .maybeSingle();
  if (recordError) {
    return NextResponse.json({ error: "Could not load the enrollment request." }, { status: 503 });
  }
  const course = (Array.isArray(record?.course) ? record?.course[0] : record?.course) as
    | { id: string; title: string | null; is_paid: boolean | null; created_by: string | null; deleted_at: string | null }
    | null
    | undefined;
  // Someone else's request looks the same as one that does not exist.
  if (!record || !course || course.deleted_at || course.created_by !== user.id) {
    return NextResponse.json({ error: "Enrollment request not found." }, { status: 404 });
  }

  const blocker = paymentConfirmationBlocker({
    courseIsPaid: Boolean(course.is_paid),
    courseOwnerId: course.created_by,
    actorId: user.id,
    requestStatus: record.status,
  });
  if (blocker) {
    return NextResponse.json({ error: blocker }, { status: 400 });
  }

  if (
    typeof body.submittedAt === "string" &&
    new Date(body.submittedAt).getTime() !== new Date(record.created_at).getTime()
  ) {
    return NextResponse.json(
      { error: "This family has sent a new application. Refresh before confirming the payment." },
      { status: 409 }
    );
  }

  const confirmedAt = received ? new Date().toISOString() : null;
  const { data: updated, error: updateError } = await db
    .from("course_enrollment_requests")
    .update({
      payment_confirmed_at: confirmedAt,
      payment_confirmed_by: received ? user.id : null,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .eq("created_at", record.created_at)
    .select("id, payment_confirmed_at")
    .maybeSingle();
  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError ? "Could not save the payment status." : "This request changed while you were looking at it. Refresh and try again." },
      { status: updateError ? 500 : 409 }
    );
  }

  // Management reviews enrollments, and this one has just become reviewable.
  if (received && !record.payment_confirmed_at) {
    const tutorName = String(user.full_name ?? "").trim() || "The tutor";
    await notifyFounders(
      "Paid course: payment confirmed",
      `<p>${escapeEnrollmentEmailHtml(tutorName)} marked the payment as received for <strong>${escapeEnrollmentEmailHtml(String(record.student_name ?? "a student"))}</strong> in <strong>${escapeEnrollmentEmailHtml(String(course.title ?? "a paid course"))}</strong>.</p>
       <p>The enrollment request can now be approved in Admin &gt; Manage enrollments.</p>`
    ).catch((error) => {
      console.error("Failed to tell management about a confirmed payment:", error);
    });
  }

  return NextResponse.json({ request: { id: updated.id, paymentConfirmedAt: updated.payment_confirmed_at } });
}
