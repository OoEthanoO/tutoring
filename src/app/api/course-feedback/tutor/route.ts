import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isExecutive, resolveUserRole } from "@/lib/roles";
import { loadTutorFeedback } from "@/lib/courseFeedbackServer";

/**
 * Feedback on the signed-in tutor's own ended courses (COURSE_FEEDBACK.md):
 * the answers without names, and only once each form has closed.
 */
export async function GET(request: NextRequest) {
  const { user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isExecutive(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  try {
    const courses = await loadTutorFeedback(getAdminClient(), String(user.id), Date.now());
    return NextResponse.json({ courses });
  } catch {
    return NextResponse.json({ error: "Could not load course feedback." }, { status: 503 });
  }
}
