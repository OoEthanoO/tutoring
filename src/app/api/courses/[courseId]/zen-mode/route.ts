import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { isAllowedRequestOrigin } from "@/lib/requestOrigin";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import { uuidPattern } from "@/lib/classTrials";
import { syncZenMode, ZenBusyError } from "@/lib/zenModeServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ courseId: string }> };
async function access(request: NextRequest, context: Context) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: "Sign in to manage Zen mode." }, { status: 401 }) };
  const { courseId } = await context.params;
  if (!uuidPattern.test(courseId)) return { error: NextResponse.json({ error: "Course not found." }, { status: 404 }) };
  const db = getAdminClient();
  const { data: course, error } = await db.from("courses").select("id, created_by, co_tutor_id, deleted_at, zen_mode_enabled").eq("id", courseId).maybeSingle();
  if (error) return { error: NextResponse.json({ error: "Could not load Zen mode." }, { status: 503 }) };
  if (!course || course.deleted_at) return { error: NextResponse.json({ error: "Course not found." }, { status: 404 }) };
  if (course.created_by !== user.id && course.co_tutor_id !== user.id && !isFounder(resolveAccountRole(user))) {
    return { error: NextResponse.json({ error: "Only this course's tutors and YanLearn management can change Zen mode." }, { status: 403 }) };
  }
  return { db, course };
}
export async function GET(request: NextRequest, context: Context) {
  const result = await access(request, context);
  if (result.error) return result.error;
  return NextResponse.json({ enabled: result.course.zen_mode_enabled });
}
export async function POST(request: NextRequest, context: Context) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const result = await access(request, context);
  if (result.error) return result.error;
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Choose whether Zen mode is on or off." }, { status: 400 });
  try {
    const outcome = await syncZenMode(result.db, { courseId: result.course.id, enabled: body.enabled });
    return NextResponse.json({ enabled: body.enabled, ...outcome });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update Zen mode." }, { status: error instanceof ZenBusyError ? 409 : 503 });
  }
}
