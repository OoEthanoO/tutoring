import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import { checkLeadershipProtection } from "@/lib/accountProtection";
import { fetchAllRows } from "@/lib/supabasePaging";
import { discordIdPattern, uuidPattern, trialWindow, type TrialLesson } from "@/lib/classTrials";
import { loadClassTrials } from "@/lib/classTrialsServer";
import { classUsesDiscordVoiceSystem } from "@/lib/discordLiveChannels";

async function management(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);
  return actor && isFounder(resolveAccountRole(actor)) ? actor : null;
}
const forbidden = () => NextResponse.json({ error: "Only YanLearn management can manage trials." }, { status: 403 });

export async function GET(request: NextRequest) {
  if (!await management(request)) return forbidden();
  try {
    const db = getAdminClient();
    const [trials, rows] = await Promise.all([
      loadClassTrials(db),
      fetchAllRows((from, to) => db.from("course_classes")
        .select("id, course_id, title, starts_at, duration_hours, course:courses!inner(id, title, deleted_at, is_completed)")
        .is("course.deleted_at", null).eq("course.is_completed", false)
        .gte("starts_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("starts_at").order("id").range(from, to)),
    ]);
    const classes = rows.map(row => ({ ...row, course: Array.isArray(row.course) ? row.course[0] : row.course })) as TrialLesson[];
    return NextResponse.json({ trials, classes: classes.filter(c => (trialWindow(c)?.expiresAtMs ?? 0) > Date.now()) });
  } catch {
    return NextResponse.json({ error: "Could not load trial classes. Check that trial-class setup is complete, then try again." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const actor = await management(request);
  if (!actor) return forbidden();
  const body = await request.json().catch(() => null);
  const classId = String(body?.classId ?? "").trim();
  const discordUserId = String(body?.discordUserId ?? "").trim();
  const studentName = String(body?.studentName ?? "").trim();
  if (!uuidPattern.test(classId) || !discordIdPattern.test(discordUserId) || !studentName || studentName.length > 100 || /[\x00-\x1f\x7f]/.test(studentName)) {
    return NextResponse.json({ error: "Choose a class, enter the student's name (up to 100 characters), and use a 17–20 digit Discord user ID." }, { status: 400 });
  }
  const db = getAdminClient();
  const [{ data: lesson, error }, { data: approved, error: approvedError }] = await Promise.all([
    db.from("course_classes").select("id, course_id, starts_at, course:courses!inner(created_by, created_by_email)").eq("id", classId).maybeSingle(),
    db.from("approved_discord_accounts").select("owner_user_id").eq("discord_user_id", discordUserId).maybeSingle(),
  ]);
  if (error || approvedError) return NextResponse.json({ error: "Could not verify the class or Discord account." }, { status: 503 });
  if (!lesson) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  const course = Array.isArray(lesson.course) ? lesson.course[0] : lesson.course;
  const [{ data: first, error: firstError }, { data: tutor, error: tutorError }] = await Promise.all([
    db.from("course_classes").select("starts_at").eq("course_id", lesson.course_id).order("starts_at").limit(1).maybeSingle(),
    course?.created_by ? db.from("app_users").select("email, role, custom_roles(role_level)").eq("id", course.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (firstError || tutorError) return NextResponse.json({ error: "Could not verify this class's Discord access." }, { status: 503 });
  if (!classUsesDiscordVoiceSystem({ founderTaught: isFounder(resolveAccountRole(tutor ?? { email: course?.created_by_email })),
    firstClassDate: first ? new Date(first.starts_at) : null, classStart: new Date(lesson.starts_at) })) {
    return NextResponse.json({ error: "This class does not use YanLearn's Discord voice channels." }, { status: 400 });
  }
  if (approved) {
    const protection = await checkLeadershipProtection(db, actor, { id: approved.owner_user_id });
    if (protection) return NextResponse.json({ error: protection.error }, { status: protection.status });
    if (body?.replaceApprovedAccount !== true) return NextResponse.json({ error: "This ID is currently a tutor-linked extra account. Tick the replacement checkbox to convert it to a trial." }, { status: 409 });
  }
  const { data: id, error: saveError } = await db.rpc("save_class_trial", {
    p_class_id: classId, p_discord_user_id: discordUserId, p_student_name: studentName,
    p_actor_id: actor.id, p_replace_owner_id: approved?.owner_user_id ?? null,
  });
  if (saveError) return NextResponse.json({ error: saveError.code === "23514" ? saveError.message : "Could not save the trial. Please try again." }, { status: saveError.code === "23514" ? 409 : 503 });
  return NextResponse.json({ id, success: true });
}

export async function DELETE(request: NextRequest) {
  if (!await management(request)) return forbidden();
  const body = await request.json().catch(() => null);
  if (!uuidPattern.test(String(body?.id ?? ""))) return NextResponse.json({ error: "Invalid trial ID." }, { status: 400 });
  // Keep the row: sync needs its Discord ID to remove stale channel access.
  const { error } = await getAdminClient().from("class_trials").update({ revoked_at: new Date().toISOString() }).eq("id", body.id);
  return error ? NextResponse.json({ error: "Could not revoke the trial." }, { status: 503 }) : NextResponse.json({ success: true });
}
