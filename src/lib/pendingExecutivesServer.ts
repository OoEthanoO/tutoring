import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabasePaging";
import { teachesCourseIds } from "@/lib/executiveStanding";
import { PENDING_WINDOW_MONTHS, pendingWindowExpired } from "@/lib/pendingExecutives";
import { resolveUserRole } from "@/lib/roles";
import {
  managementChannelName,
  sendDiscordMessageByChannelName,
  sendEmail,
} from "@/lib/notificationsServer";

/**
 * The database side of the Pending window (pendingExecutives.ts): the
 * class-reminders cron calls this every tick, and it turns executives who are
 * still Pending six months after their promotion back into students.
 */

type TutorRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  tutor_promoted_at: string | null;
  pending_role_exempt: boolean | null;
  custom_roles: { role_level: string | null } | { role_level: string | null }[] | null;
};

export type PendingDemotionResult = { demotedUserIds: string[]; errors: string[] };

const customLevels = (row: TutorRow): string[] => {
  const roles = Array.isArray(row.custom_roles) ? row.custom_roles : row.custom_roles ? [row.custom_roles] : [];
  return roles.map((role) => String(role.role_level ?? "")).filter(Boolean);
};

export const demoteExpiredPendingExecutives = async (
  client: SupabaseClient,
  nowMs: number
): Promise<PendingDemotionResult> => {
  const result: PendingDemotionResult = { demotedUserIds: [], errors: [] };

  const tutors = await fetchAllRows<TutorRow>((from, to) =>
    client
      .from("app_users")
      .select("id, email, full_name, role, tutor_promoted_at, pending_role_exempt, custom_roles(role_level)")
      .eq("role", "tutor")
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: TutorRow[] | null; error: { message: string } | null }>
  );
  if (tutors.length === 0) return result;

  const courses = await fetchAllRows<{ created_by: string | null; co_tutor_id: string | null }>((from, to) =>
    client.from("courses").select("created_by, co_tutor_id").is("deleted_at", null).order("id").range(from, to)
  );
  const teaching = teachesCourseIds(courses);

  const requests = await fetchAllRows<{ created_by: string | null }>((from, to) =>
    client.from("course_creation_requests").select("created_by").eq("status", "in_review").order("id").range(from, to)
  );
  const waiting = new Set(requests.map((row) => String(row.created_by ?? "")).filter(Boolean));

  for (const tutor of tutors) {
    const expired = pendingWindowExpired(
      {
        role: resolveUserRole(tutor.email, tutor.role, customLevels(tutor)),
        teachesCourse: teaching.has(tutor.id),
        exempt: Boolean(tutor.pending_role_exempt),
        promotedAt: tutor.tutor_promoted_at,
        hasOpenCourseRequest: waiting.has(tutor.id),
      },
      nowMs
    );
    if (!expired) continue;

    // Only a row that is still a tutor is changed, so an overlapping tick or a
    // manual change made a moment ago is never demoted or announced twice.
    const { data: changed, error } = await client
      .from("app_users")
      .update({ role: "student", senior_tutor: false, custom_role: null })
      .eq("id", tutor.id)
      .eq("role", "tutor")
      .select("id");
    if (error) {
      result.errors.push(`Could not demote pending executive ${tutor.id}: ${error.message}`);
      continue;
    }
    if (!changed || changed.length === 0) continue;
    result.demotedUserIds.push(tutor.id);

    const name = String(tutor.full_name ?? "").trim() || String(tutor.email ?? "").trim() || "An executive";
    try {
      if (tutor.email) {
        await sendEmail(
          tutor.email,
          "Your YanLearn executive role has ended",
          `<p>Hi ${name},</p>
<p>You became a YanLearn executive ${PENDING_WINDOW_MONTHS} months ago and have not taught a course since, so your account has been changed back to a student account automatically.</p>
<p>Nothing else about your account has changed. If you would still like to teach, reply to this email or contact management and we can make you an executive again.</p>`
        );
      }
      await sendDiscordMessageByChannelName(
        managementChannelName(),
        `**${name}** was Pending for ${PENDING_WINDOW_MONTHS} months without a course and is now a student again (automatic). ` +
          "To undo it, make them an executive again in Admin → Manage accounts."
      );
    } catch (notifyError) {
      result.errors.push(
        `Demoted ${tutor.id} but could not notify: ${notifyError instanceof Error ? notifyError.message : "Unknown error"}`
      );
    }
  }
  return result;
};
