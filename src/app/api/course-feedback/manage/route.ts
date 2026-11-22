import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { loadManagementFeedback } from "@/lib/courseFeedbackServer";

/**
 * Every response to the post-course feedback forms, with students' names
 * (COURSE_FEEDBACK.md). Management only.
 */
export async function GET(request: NextRequest) {
  const { user } = await getRequestAuthContext(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  try {
    const courses = await loadManagementFeedback(getAdminClient(), Date.now());
    return NextResponse.json({ courses });
  } catch {
    return NextResponse.json({ error: "Could not load course feedback." }, { status: 503 });
  }
}
