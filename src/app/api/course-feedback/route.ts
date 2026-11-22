import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { feedbackColumns, parseFeedbackSubmission } from "@/lib/courseFeedback";
import { loadStudentFeedbackForms, saveStudentFeedback } from "@/lib/courseFeedbackServer";

/**
 * A student's optional post-course feedback forms (COURSE_FEEDBACK.md).
 *
 * GET lists the open forms: courses the signed-in student is enrolled in
 * whose last class ended in the last 30 days, with any answers already given.
 * POST saves answers for one of them, or "No thanks" ({ declined: true }).
 * Answers can be changed until the form closes.
 */

export async function GET(request: NextRequest) {
  const { user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const forms = await loadStudentFeedbackForms(getAdminClient(), String(user.id), Date.now());
    return NextResponse.json({ forms });
  } catch {
    return NextResponse.json({ error: "Could not load your feedback forms." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { user, isImpersonating } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Management viewing the site as a student must not answer for them.
  if (isImpersonating) {
    return NextResponse.json(
      { error: "You are viewing the site as this student. Only the student can give their feedback." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const courseId = typeof body?.courseId === "string" ? body.courseId.trim() : "";
  if (!courseId) {
    return NextResponse.json({ error: "Which course is this feedback for?" }, { status: 400 });
  }
  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const nowMs = Date.now();
  const client = getAdminClient();
  const outcome = await saveStudentFeedback(
    client, String(user.id), courseId, feedbackColumns(parsed, new Date(nowMs).toISOString()), nowMs
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  try {
    const forms = await loadStudentFeedbackForms(client, String(user.id), nowMs);
    return NextResponse.json({ ok: true, form: forms.find((form) => form.courseId === courseId) ?? null });
  } catch {
    return NextResponse.json({ ok: true, form: null });
  }
}
