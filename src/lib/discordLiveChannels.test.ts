import { describe, expect, it } from "vitest";
import {
  buildLiveVoicePermissionOverwrites,
  decideLiveChannelCleanup,
  liveChannelEmptyConfirmMs,
  liveChannelGraceAfterEndMs,
  normalizeVoiceChannelName,
} from "@/lib/discordLiveChannels";

const viewChannel = 1024;
const connect = 1048576;
const speak = 2097152;
const manageChannels = 16;
const allowJoin = String(viewChannel | connect | speak);

const baseParams = {
  guildId: "guild",
  botUserId: "bot",
  ceoRoleId: null,
  cooRoleId: null,
  tutorDiscordUserId: "tutor",
  courseRoleId: null,
};

describe("buildLiveVoicePermissionOverwrites", () => {
  it("denies @everyone and admits only bot and tutor by default", () => {
    const overwrites = buildLiveVoicePermissionOverwrites(baseParams);

    expect(overwrites).toHaveLength(3);
    expect(overwrites[0]).toEqual({
      id: "guild",
      type: 0,
      allow: "0",
      deny: allowJoin,
    });
    expect(overwrites[1]).toEqual({
      id: "bot",
      type: 1,
      allow: String(viewChannel | connect | speak | manageChannels),
      deny: "0",
    });
    expect(overwrites[2]).toEqual({
      id: "tutor",
      type: 1,
      allow: allowJoin,
      deny: "0",
    });
  });

  it("gives approved extra accounts the same access as the tutor", () => {
    const overwrites = buildLiveVoicePermissionOverwrites({
      ...baseParams,
      extraMemberDiscordUserIds: ["extra-1", "extra-2"],
    });

    const extras = overwrites.filter((o) => o.id.startsWith("extra-"));
    expect(extras).toEqual([
      { id: "extra-1", type: 1, allow: allowJoin, deny: "0" },
      { id: "extra-2", type: 1, allow: allowJoin, deny: "0" },
    ]);
  });

  it("dedupes extra accounts and never duplicates the tutor", () => {
    const overwrites = buildLiveVoicePermissionOverwrites({
      ...baseParams,
      extraMemberDiscordUserIds: ["extra-1", "extra-1", "tutor", ""],
    });

    expect(overwrites.filter((o) => o.id === "extra-1")).toHaveLength(1);
    expect(overwrites.filter((o) => o.id === "tutor")).toHaveLength(1);
    expect(overwrites.some((o) => o.id === "")).toBe(false);
  });

  it("adds the course role only when provided (post early-access window)", () => {
    const withoutRole = buildLiveVoicePermissionOverwrites(baseParams);
    expect(withoutRole.some((o) => o.id === "course-role")).toBe(false);

    const withRole = buildLiveVoicePermissionOverwrites({
      ...baseParams,
      courseRoleId: "course-role",
    });
    expect(withRole).toContainEqual({
      id: "course-role",
      type: 0,
      allow: allowJoin,
      deny: "0",
    });
  });

  it("admits CEO and COO roles when configured", () => {
    const overwrites = buildLiveVoicePermissionOverwrites({
      ...baseParams,
      ceoRoleId: "ceo",
      cooRoleId: "coo",
    });

    expect(overwrites).toContainEqual({ id: "ceo", type: 0, allow: allowJoin, deny: "0" });
    expect(overwrites).toContainEqual({ id: "coo", type: 0, allow: allowJoin, deny: "0" });
  });
});

describe("normalizeVoiceChannelName", () => {
  it("lowercases and dashes titles", () => {
    expect(normalizeVoiceChannelName("Intro to Python", "class-1")).toBe(
      "intro-to-python"
    );
  });

  it("keeps existing hyphens and collapses punctuation runs", () => {
    expect(normalizeVoiceChannelName("Pre-Calc: Unit 2!", "class-1")).toBe(
      "pre-calc-unit-2"
    );
  });

  it("falls back to a class-id-derived name for empty titles", () => {
    expect(normalizeVoiceChannelName("!!!", "abcdefgh-rest")).toBe(
      "class-abcdefgh"
    );
  });

  it("caps the name at Discord's 100-character limit", () => {
    expect(normalizeVoiceChannelName("a".repeat(150), "class-1")).toHaveLength(100);
  });
});

describe("decideLiveChannelCleanup", () => {
  const MIN = 60 * 1000;
  // A 7:00-8:00 PM class — the shape of the lesson that was cut off at ~8:03 PM.
  const endsAtMs = new Date("2026-07-30T20:00:00-04:00").getTime();
  const at = (minutesAfterEnd: number) => endsAtMs + minutesAfterEnd * MIN;
  const decide = decideLiveChannelCleanup;

  it("never deletes before the scheduled end", () => {
    expect(
      decide({
        nowMs: at(-1),
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: at(-30),
      })
    ).toBe("keep");
  });

  it("keeps the channel while anyone at all is in the call, however long the overrun", () => {
    // The incident: students were still in the call at 8:03 PM.
    expect(
      decide({
        nowMs: at(3),
        endsAtMs,
        someonePresent: true,
        lookupFailed: false,
        emptySinceMs: null,
      })
    ).toBe("keep");

    expect(
      decide({
        nowMs: at(240),
        endsAtMs,
        someonePresent: true,
        lookupFailed: false,
        emptySinceMs: null,
      })
    ).toBe("keep");
  });

  it("starts the clock rather than deleting on first sight of an empty call", () => {
    expect(
      decide({
        nowMs: at(3),
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: null,
      })
    ).toBe("mark-empty");
  });

  it("never deletes when occupancy could not be determined", () => {
    // Covers both a failed voice-state read and an unreadable guild member list:
    // "we could not tell" must never be treated as "nobody is there".
    expect(
      decide({
        nowMs: at(600),
        endsAtMs,
        someonePresent: false,
        lookupFailed: true,
        emptySinceMs: at(0),
      })
    ).toBe("keep");
  });

  it("resets the clock the moment anyone reappears, so a flaky connection never accumulates", () => {
    expect(
      decide({
        nowMs: at(4),
        endsAtMs,
        someonePresent: true,
        lookupFailed: false,
        emptySinceMs: at(1),
      })
    ).toBe("clear-empty");
  });

  it("holds while the call has been empty for 5 minutes or less", () => {
    expect(
      decide({
        nowMs: at(5),
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: at(1),
      })
    ).toBe("keep");

    // Exactly 5 minutes is not "more than 5 minutes".
    expect(
      decide({
        nowMs: at(1) + liveChannelEmptyConfirmMs,
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: at(1),
      })
    ).toBe("keep");
  });

  it("deletes once the call has been empty for more than 5 minutes", () => {
    expect(
      decide({
        nowMs: at(1) + liveChannelEmptyConfirmMs + 1,
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: at(1),
      })
    ).toBe("delete");
  });

  it("keeps the channel when the end time is unparseable", () => {
    expect(
      decide({
        nowMs: at(600),
        endsAtMs: Number.NaN,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: at(0),
      })
    ).toBe("keep");
  });

  it("re-marks rather than deletes when the stored empty_since is unusable", () => {
    expect(
      decide({
        nowMs: at(600),
        endsAtMs,
        someonePresent: false,
        lookupFailed: false,
        emptySinceMs: Number.NaN,
      })
    ).toBe("mark-empty");
  });

  it("leaves the recovery window wide enough to recreate a channel mid-overrun", () => {
    // A channel deleted just after the earliest possible moment can still be
    // recovered while the class runs late.
    expect(liveChannelGraceAfterEndMs).toBeGreaterThan(liveChannelEmptyConfirmMs);
  });
});
