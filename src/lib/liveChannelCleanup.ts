import type { SupabaseClient } from "@supabase/supabase-js";
import { decideLiveChannelCleanup, liveClassEndMs, type LiveChannelPresence } from "@/lib/discordLiveChannels";

/** Re-read the real class schedule and current clocks immediately before DELETE. */
export const deleteFinishedLiveChannel = async ({
  adminClient, rowId, channelId, presence, deleteChannel, now = Date.now,
}: {
  adminClient: SupabaseClient;
  rowId: string;
  channelId: string;
  presence: Pick<LiveChannelPresence, "someonePresent" | "lookupFailed" | "tutorPresent" | "tutorLookupFailed">;
  deleteChannel: (id: string) => Promise<unknown>;
  now?: () => number;
}): Promise<boolean> => {
  const { data, error } = await adminClient.from("discord_live_class_channels")
    .select("discord_channel_id, empty_since, tutor_absent_since, class:course_classes(starts_at, duration_hours)")
    .eq("id", rowId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.discord_channel_id !== channelId) return false;
  const schedule = Array.isArray(data.class) ? data.class[0] ?? null : data.class;
  const endsAtMs = liveClassEndMs(schedule);
  if (endsAtMs === null) return false;
  const decision = decideLiveChannelCleanup({
    ...presence, nowMs: now(), endsAtMs,
    emptySinceMs: data.empty_since ? Date.parse(data.empty_since) : null,
    tutorAbsentSinceMs: data.tutor_absent_since ? Date.parse(data.tutor_absent_since) : null,
  });
  if (decision !== "delete") return false;
  try {
    await deleteChannel(channelId);
  } catch (error) {
    // A confirmed missing channel can be marked deleted, but never an outage.
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("unknown channel")) throw error;
  }
  const { error: updateError } = await adminClient.from("discord_live_class_channels")
    .update({ deleted_at: new Date(now()).toISOString() })
    .eq("id", rowId).eq("discord_channel_id", channelId).is("deleted_at", null);
  if (updateError) throw new Error(updateError.message);
  return true;
};
