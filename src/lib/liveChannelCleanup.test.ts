import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideLiveChannelCleanup, liveClassEndMs, observeLiveChannelPresence, preserveLiveVoiceChannel } from "./discordLiveChannels";
import { deleteFinishedLiveChannel } from "./liveChannelCleanup";

const minute = 60000;
const start = Date.parse("2026-09-12T19:00:00-04:00");
const end = start + 90 * minute;
const base = {
  nowMs: end + minute, endsAtMs: end, someonePresent: false, lookupFailed: false,
  tutorPresent: false, tutorLookupFailed: false, emptySinceMs: null, tutorAbsentSinceMs: null,
};

describe("live channel countdowns", () => {
  it.each([start - 15 * minute, start, end - minute, end])("has no active countdown at %s", (nowMs) => {
    const state = { ...base, nowMs, emptySinceMs: start - minute, tutorAbsentSinceMs: start - minute };
    expect(observeLiveChannelPresence(state)).toEqual({ emptySinceMs: null, tutorAbsentSinceMs: null });
    expect(decideLiveChannelCleanup(state)).toBe("keep");
  });

  it("starts both clocks on the first confirmed absence after the end", () => {
    expect(observeLiveChannelPresence({ ...base, emptySinceMs: start, tutorAbsentSinceMs: start })).toEqual({
      emptySinceMs: base.nowMs, tutorAbsentSinceMs: base.nowMs,
    });
  });

  it("waits a full five minutes after the post-end empty observation", () => {
    const clocks = observeLiveChannelPresence(base);
    expect(decideLiveChannelCleanup({ ...base, ...clocks, nowMs: end + 6 * minute })).toBe("keep");
    expect(decideLiveChannelCleanup({ ...base, ...clocks, nowMs: end + 6 * minute + 1 })).toBe("delete");
  });

  it("waits a full thirty minutes without a tutor after class ends, even with students present", () => {
    const state = { ...base, someonePresent: true };
    const clocks = observeLiveChannelPresence(state);
    expect(clocks.emptySinceMs).toBeNull();
    expect(decideLiveChannelCleanup({ ...state, ...clocks, nowMs: end + 31 * minute })).toBe("keep");
    expect(decideLiveChannelCleanup({ ...state, ...clocks, nowMs: end + 31 * minute + 1 })).toBe("delete");
  });

  it("resets the tutor clock when they return after class, independently of attendance polling", () => {
    const clocks = observeLiveChannelPresence({ ...base, someonePresent: true });
    const returned = observeLiveChannelPresence({ ...base, ...clocks, nowMs: end + 25 * minute, tutorPresent: true });
    expect(returned).toEqual({ emptySinceMs: null, tutorAbsentSinceMs: null });
    const absentAgain = observeLiveChannelPresence({ ...base, ...returned, nowMs: end + 26 * minute, someonePresent: true });
    expect(decideLiveChannelCleanup({ ...base, ...absentAgain, someonePresent: true, nowMs: end + 32 * minute })).toBe("keep");
  });

  it("restarts both clocks after an unknown voice state, preventing outage time from counting", () => {
    const clocks = observeLiveChannelPresence(base);
    const unknown = observeLiveChannelPresence({ ...base, ...clocks, lookupFailed: true, tutorLookupFailed: true });
    expect(unknown).toEqual({ emptySinceMs: null, tutorAbsentSinceMs: null });
    const resumed = observeLiveChannelPresence({ ...base, ...unknown, nowMs: end + 40 * minute });
    expect(decideLiveChannelCleanup({ ...base, ...resumed, nowMs: end + 40 * minute })).toBe("keep");
  });

  it("does not turn an unreadable schedule into a default one-hour class", () => {
    expect(liveClassEndMs(null)).toBeNull();
    expect(liveClassEndMs({ starts_at: "invalid", duration_hours: 1.5 })).toBeNull();
    expect(liveClassEndMs({ starts_at: new Date(start).toISOString(), duration_hours: null })).toBeNull();
    expect(liveClassEndMs({ starts_at: new Date(start).toISOString(), duration_hours: "1.50" })).toBe(end);
  });
});

describe("guild sweep protection", () => {
  const params = { liveCategoryIds: new Set(["live"]), trackedChannelIds: new Set(["tracked"]), registryLoaded: true };
  it("protects a new channel before its database row is inserted", () => {
    expect(preserveLiveVoiceChannel({ ...params, channel: { id: "new", type: 2, parent_id: "live" } })).toBe(true);
  });
  it("protects a tracked channel even outside Live or with a stale deleted marker", () => {
    expect(preserveLiveVoiceChannel({ ...params, channel: { id: "tracked", type: 2 } })).toBe(true);
  });
  it("skips all voice deletion if the registry query fails", () => {
    expect(preserveLiveVoiceChannel({ ...params, registryLoaded: false, channel: { id: "unknown", type: 2 } })).toBe(true);
  });
  it("still allows unrelated managed-channel cleanup when the registry is known", () => {
    expect(preserveLiveVoiceChannel({ ...params, channel: { id: "other", type: 2 } })).toBe(false);
    expect(preserveLiveVoiceChannel({ ...params, registryLoaded: false, channel: { id: "text", type: 0 } })).toBe(false);
  });
});

describe("final deletion guard", () => {
  const snapshot = {
    discord_channel_id: "voice", empty_since: new Date(end + minute).toISOString(),
    tutor_absent_since: new Date(end + minute).toISOString(),
    class: { starts_at: new Date(start).toISOString(), duration_hours: 1.5 },
  };
  const setup = (data: unknown = snapshot, error: unknown = null) => {
    const update = vi.fn();
    const query = {
      select: () => query, eq: () => query, is: () => query,
      maybeSingle: async () => ({ data, error }),
      update: (value: unknown) => { update(value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    const options = {
      adminClient: { from: () => query } as unknown as SupabaseClient,
      rowId: "row", channelId: "voice", presence: base,
      deleteChannel: vi.fn(async () => {}), now: () => end + 7 * minute,
    };
    return { options, update };
  };

  it.each([start, start + minute, end - 8 * minute, end])("never calls Discord DELETE before or at class end (%s)", async (nowMs) => {
    const { options } = setup({ ...snapshot, empty_since: new Date(start - 60 * minute).toISOString() });
    expect(await deleteFinishedLiveChannel({ ...options, now: () => nowMs })).toBe(false);
    expect(options.deleteChannel).not.toHaveBeenCalled();
  });
  it("honors an extended schedule even if the earlier cleanup snapshot said the class ended", async () => {
    const { options } = setup({ ...snapshot, class: { ...snapshot.class, duration_hours: 2 } });
    expect(await deleteFinishedLiveChannel(options)).toBe(false);
    expect(options.deleteChannel).not.toHaveBeenCalled();
  });
  it("preserves a channel whose class row is missing", async () => {
    const { options } = setup({ ...snapshot, class: null });
    expect(await deleteFinishedLiveChannel(options)).toBe(false);
  });
  it("does not delete an old channel or mark its replacement deleted after recovery", async () => {
    const { options, update } = setup({ ...snapshot, discord_channel_id: "replacement" });
    expect(await deleteFinishedLiveChannel(options)).toBe(false);
    expect(options.deleteChannel).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("preserves the channel when the final database read fails", async () => {
    const { options } = setup(null, { message: "Gateway Timeout" });
    await expect(deleteFinishedLiveChannel(options)).rejects.toThrow("Gateway Timeout");
    expect(options.deleteChannel).not.toHaveBeenCalled();
  });
  it("deletes and marks only an eligible channel", async () => {
    const { options, update } = setup();
    expect(await deleteFinishedLiveChannel(options)).toBe(true);
    expect(options.deleteChannel).toHaveBeenCalledWith("voice");
    expect(update).toHaveBeenCalledWith({ deleted_at: new Date(options.now()).toISOString() });
  });
  it("does not mark deleted when Discord rejects the deletion", async () => {
    const { options, update } = setup();
    options.deleteChannel.mockRejectedValue(new Error("rate limited"));
    await expect(deleteFinishedLiveChannel(options)).rejects.toThrow("rate limited");
    expect(update).not.toHaveBeenCalled();
  });
});
