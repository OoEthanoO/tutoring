import type { SupabaseClient } from "@supabase/supabase-js";
import { decideLiveChannelCleanup, liveClassEndMs, type LiveChannelPresence } from "@/lib/discordLiveChannels";

type CategoryChannel = { id: string; name: string; type: number; parent_id?: string | null };

/** Run after channel creation/recovery and cleanup, never from the guild sweep. */
export const deleteEmptyLiveCategories = async ({
  listChannels, deleteChannel, hasClassesInLiveWindow, categoryName = "Live",
}: {
  listChannels: () => Promise<CategoryChannel[]>;
  deleteChannel: (id: string) => Promise<unknown>;
  hasClassesInLiveWindow: boolean;
  categoryName?: string;
}): Promise<string[]> => {
  // An empty category may be waiting for a class channel to be created/recovered.
  if (hasClassesInLiveWindow) return [];
  const isLiveCategory = (channel: CategoryChannel) => channel.type === 4 &&
    channel.name.trim().toLowerCase() === categoryName.trim().toLowerCase();
  const channels = await listChannels();
  const candidates = channels.filter(channel => isLiveCategory(channel) &&
    !channels.some(child => child.parent_id === channel.id));
  const deleted: string[] = [];
  for (const candidate of candidates) {
    // Do not trust the tick's earlier snapshot or the class registry: breakout
    // rooms and newly created/untracked channels also keep their parent alive.
    const current = await listChannels();
    if (!current.some(channel => channel.id === candidate.id && isLiveCategory(channel)) ||
      current.some(channel => channel.parent_id === candidate.id)) continue;
    try {
      await deleteChannel(candidate.id);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("unknown channel")) throw error;
    }
    deleted.push(candidate.id);
  }
  return deleted;
};

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
