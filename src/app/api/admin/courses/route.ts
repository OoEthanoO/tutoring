import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isExecutive, isFounder, resolveAccountRole } from "@/lib/roles";
import { isAllowedRequestOrigin } from "@/lib/requestOrigin";
import { fetchAllRows } from "@/lib/supabasePaging";
import { parseNewCourse } from "@/lib/newCourse";
import { insertCourseWithClasses } from "@/lib/courseCreation";
import { findPaidCourseBlocker } from "@/lib/paidCoursesServer";
import { formatPaidFee } from "@/lib/paidCourses";
import { classEndDate } from "@/lib/classTiming";
import { executivesChannelName, sendDiscordMessageByChannelName, sendEmail } from "@/lib/notificationsServer";

export const dynamic = "force-dynamic";

/**
 * Management creates a course directly, without a course request
 * (Teaching → Course requests → Create course). The course gets the same row
 * an approved request would (courseCreation.ts) and the same paid-course
 * rules (PAID_COURSES.md). GET lists the executives who can teach it.
 */

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  custom_role: string | null;
  custom_roles: { role_level: string | null } | { role_level: string | null }[] | null;
  senior_tutor: boolean | null;
  discord_user_id: string | null;
};

const userColumns = "id, full_name, email, role, custom_role, custom_roles(role_level), senior_tutor, discord_user_id";
// Executive and above, custom roles included (CEO Shadow teaches at the Executive level).
const teaches = (user: UserRow | null | undefined): user is UserRow =>
  Boolean(user) && isExecutive(resolveAccountRole(user as UserRow));

const displayName = (user: Pick<UserRow, "full_name" | "email">) =>
  String(user.full_name ?? "").trim() || user.email || "Tutor";

// The signed-in account itself, so management can do this while viewing the site as someone else.
const requireManagement = async (request: NextRequest) => {
  const { actor } = await getRequestAuthContext(request);
  if (!actor) return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  if (!isFounder(resolveAccountRole(actor))) {
    return { error: NextResponse.json({ error: "Forbidden. Only management can create courses." }, { status: 403 }) };
  }
  return { user: actor };
};

export async function GET(request: NextRequest) {
  const gate = await requireManagement(request);
  if (gate.error) return gate.error;
  const adminClient = getAdminClient();
  try {
    const users = await fetchAllRows<UserRow>((from, to) =>
      adminClient.from("app_users").select(userColumns).order("id", { ascending: true }).range(from, to)
    );
    const executives = users.filter(teaches);
    const { data: profiles, error } = await adminClient
      .from("tutor_profiles").select("user_id, payment_note").in("user_id", executives.map((user) => user.id));
    if (error) throw new Error(error.message);
    const withNote = new Set(
      (profiles ?? []).filter((row) => String(row.payment_note ?? "").trim()).map((row) => String(row.user_id))
    );
    const tutors = executives
      .map((user) => ({
        id: user.id,
        name: displayName(user),
        seniorTutor: user.senior_tutor === true,
        hasPaymentNote: withNote.has(user.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return NextResponse.json({ tutors, currentUserId: gate.user.id });
  } catch {
    return NextResponse.json({ error: "Could not load the tutors." }, { status: 503 });
  }
}

const formatClassLines = (classes: { startsAt: string; durationHours: number }[]) =>
  classes.map((item, index) => {
    const startsAt = new Date(item.startsAt);
    const endsAt = classEndDate(startsAt, item.durationHours);
    const options = { timeZone: "America/Toronto" } as const;
    const date = startsAt.toLocaleDateString("en-US", { ...options, month: "numeric", day: "numeric", year: "numeric" });
    const start = startsAt.toLocaleTimeString("en-US", { ...options, hour: "numeric", minute: "2-digit" });
    const end = endsAt.toLocaleTimeString("en-US", { ...options, hour: "numeric", minute: "2-digit" });
    return `Class ${index + 1}: ${date} · ${start} - ${end}`;
  }).join("\n");

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const gate = await requireManagement(request);
  if (gate.error) return gate.error;
  const creator = gate.user;

  const parsed = parseNewCourse(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const course = parsed.course;
  const adminClient = getAdminClient();

  const ids = [course.ownerId, course.coTutorId].filter((value): value is string => Boolean(value));
  const { data: userRows, error: usersError } = await adminClient
    .from("app_users").select(userColumns).in("id", ids);
  if (usersError) {
    return NextResponse.json({ error: "Could not check the tutors." }, { status: 503 });
  }
  const byId = new Map(((userRows ?? []) as UserRow[]).map((row) => [String(row.id), row]));
  const owner = byId.get(course.ownerId);
  const coTutor = course.coTutorId ? byId.get(course.coTutorId) : null;
  if (!teaches(owner)) {
    return NextResponse.json({ error: "The tutor must be an executive." }, { status: 400 });
  }
  if (course.coTutorId && !teaches(coTutor)) {
    return NextResponse.json({ error: "The co-tutor must be an executive." }, { status: 400 });
  }

  // Same gate as approving a paid request: senior tutors with a payment note.
  if (course.isPaid) {
    let blocker: string | null;
    try {
      blocker = await findPaidCourseBlocker(adminClient, {
        ownerId: course.ownerId, coTutorId: course.coTutorId, fee: course.paidFee,
      });
    } catch {
      return NextResponse.json({ error: "Could not check senior tutor standing." }, { status: 503 });
    }
    if (blocker) {
      return NextResponse.json({ error: blocker }, { status: 400 });
    }
  }

  const ownerRow = owner as UserRow;
  const created = await insertCourseWithClasses(adminClient, {
    title: course.title,
    description: course.description,
    max_students: course.maxStudents,
    donation_fee: course.isPaid ? null : course.donationFee,
    is_paid: course.isPaid,
    paid_fee: course.isPaid ? course.paidFee : null,
    grade_level: course.gradeLevel,
    created_by: ownerRow.id,
    created_by_name: displayName(ownerRow),
    created_by_email: ownerRow.email ?? null,
    is_co_taught: Boolean(coTutor),
    co_tutor_id: coTutor ? coTutor.id : null,
    co_tutor_name: coTutor ? displayName(coTutor) : null,
    co_tutor_email: coTutor ? coTutor.email ?? null : null,
    recordings_enabled: course.recordingsEnabled,
  }, course.classes.map((item, index) => ({ ...item, title: `Class ${index + 1}` })));
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  // Tell the tutors, as approval does, unless management made the course for itself.
  let announced = true;
  const toTell = [ownerRow, coTutor].filter((user): user is UserRow => Boolean(user) && user?.id !== creator.id);
  if (toTell.length > 0) {
    const classLines = formatClassLines(course.classes);
    const fee = course.isPaid ? `Paid course: ${formatPaidFee(course.paidFee)}, paid directly to the tutor.` : null;
    try {
      for (const tutor of toTell) {
        if (!tutor.email) continue;
        await sendEmail(
          tutor.email,
          `New course: ${course.title}`,
          `<p>Hi ${escapeHtml(String(tutor.full_name ?? "").trim() || "there")},</p>
<p>Management created the course <strong>${escapeHtml(course.title)}</strong> for you to teach. It is in My courses on the website.</p>
<p><strong>Max Students:</strong> ${course.maxStudents ?? "Unlimited"}</p>
${fee ? `<p><strong>${escapeHtml(fee)}</strong> When a family applies, mark their payment as received in My courses.</p>` : ""}
<h3>Classes</h3>
<pre>${escapeHtml(classLines || "No classes scheduled yet.")}</pre>
<p>Check that the details and the schedule work for you, and tell management straight away if not.</p>`
        );
      }
      const mentions = toTell
        .map((tutor) => (tutor.discord_user_id ? `<@${tutor.discord_user_id}>` : `**${displayName(tutor)}**`))
        .join(" ");
      announced = await sendDiscordMessageByChannelName(
        executivesChannelName(),
        `${mentions} Management created the course **${course.title}** for you.\n\n**Details:**\n- **Max Students:** ${course.maxStudents ?? "Unlimited"}\n${fee ? `- ${fee}\n` : ""}**Classes:**\n${classLines || "No classes scheduled."}`
      );
    } catch (error) {
      console.error("Failed to announce a created course:", error);
      announced = false;
    }
  }

  return NextResponse.json({ success: true, courseId: created.courseId, classesAdded: created.classesAdded, announced });
}
