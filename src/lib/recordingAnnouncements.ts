import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRecordingReadyDiscordMessage } from "@/lib/discordCourseMessages";
import { sendDiscordCourseRoleMessage } from "@/lib/notificationsServer";

const siteUrl =
  String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "") ||
  "https://learn.ethanyanxu.com";

type ReadyRecordingAnnouncement = {
  id: string;
  course_id: string;
  class_id: string;
  discord_announced_at?: string | null;
};

export type RecordingAnnouncementRetryResult = {
  announcedCount: number;
  errors: string[];
};

/** Announce one ready recording and persist success so later runs skip it. */
export const announceReadyRecording = async (
  adminClient: SupabaseClient,
  recording: ReadyRecordingAnnouncement
): Promise<boolean> => {
  if (recording.discord_announced_at) {
    return true;
  }

  const { data: classRow } = await adminClient
    .from("course_classes")
    .select("title")
    .eq("id", recording.class_id)
    .maybeSingle();
  const sent = await sendDiscordCourseRoleMessage(
    String(recording.course_id),
    (roleId) =>
      buildRecordingReadyDiscordMessage({
        roleId,
        classTitle: String(classRow?.title ?? "Your class"),
        siteUrl,
      })
  );
  if (!sent) {
    return false;
  }

  const { error } = await adminClient
    .from("class_recordings")
    .update({ discord_announced_at: new Date().toISOString() })
    .eq("id", recording.id)
    .is("discord_announced_at", null);
  if (error) {
    console.error(`Failed to save Discord announcement for recording ${recording.id}:`, error);
    return false;
  }
  return true;
};

/** Retry announcements missed during upload completion without re-uploading video. */
export const retryPendingRecordingAnnouncements = async (
  adminClient: SupabaseClient,
  nowMs = Date.now()
): Promise<RecordingAnnouncementRetryResult> => {
  const result: RecordingAnnouncementRetryResult = { announcedCount: 0, errors: [] };
  const { data, error } = await adminClient
    .from("class_recordings")
    .select("id, course_id, class_id, discord_announced_at")
    .eq("status", "ready")
    .is("discord_announced_at", null)
    .gt("expires_at", new Date(nowMs).toISOString())
    .order("uploaded_at", { ascending: true })
    .limit(25);
  if (error) {
    result.errors.push(`Failed to load pending recording announcements: ${error.message}`);
    return result;
  }

  for (const recording of (data ?? []) as ReadyRecordingAnnouncement[]) {
    if (await announceReadyRecording(adminClient, recording)) {
      result.announcedCount += 1;
    } else {
      result.errors.push(`Failed to announce recording ${recording.id}.`);
    }
  }
  return result;
};
