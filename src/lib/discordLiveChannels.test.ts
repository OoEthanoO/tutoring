import { describe, expect, it } from "vitest";
import {
  buildLiveVoicePermissionOverwrites,
  classOnSchoolhouse,
  classUsesDiscordVoiceSystem,
  courseUsesDiscordVoiceSystem,
  decideLiveChannelCleanup,
  discordVoiceSystemStartMs,
  founderSchoolhouseEndMs,
  liveChannelEmptyConfirmMs,
  liveChannelTutorAbsenceMs,
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

  it("keeps the channel while anyone at all is in the call, for as long as the tutor is there", () => {
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
        tutorPresent: true,
        tutorLookupFailed: false,
        tutorLastSeenMs: at(240),
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

  describe("tutor absence", () => {
    // A room full of students the tutor walked out of: the emptiness clock can
    // never start, so only the absence rule can ever clear this channel.
    const occupiedByStudents = {
      endsAtMs,
      someonePresent: true,
      lookupFailed: false,
      emptySinceMs: null,
      tutorPresent: false,
      tutorLookupFailed: false,
    };

    it("deletes over students still in the call once the tutor has been gone more than 30 minutes", () => {
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(5),
          tutorLastSeenMs: at(-26),
        })
      ).toBe("delete");
    });

    it("counts absence from the last sighting, including time before the class ended", () => {
      // Left 40 minutes before the end: already past 30 minutes at the end, so
      // the first post-end tick clears it.
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(1),
          tutorLastSeenMs: at(-40),
        })
      ).toBe("delete");
    });

    it("holds at exactly 30 minutes", () => {
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(0) + 1 + liveChannelTutorAbsenceMs,
          tutorLastSeenMs: at(0) + 1,
        })
      ).toBe("keep");
    });

    it("restarts the clock while the tutor is in the call", () => {
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(600),
          tutorPresent: true,
          tutorLastSeenMs: at(-30),
        })
      ).toBe("keep");
    });

    it("never deletes on an unknown tutor voice state", () => {
      // A failed read, or no recorded tutor to read: absence must be observed,
      // never assumed.
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(600),
          tutorLookupFailed: true,
          tutorLastSeenMs: at(-600),
        })
      ).toBe("keep");

      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(600),
          tutorLastSeenMs: null,
        })
      ).toBe("keep");
    });

    it("still waits for the scheduled end", () => {
      // Mid-lesson the channel stays up whatever the tutor is doing; the
      // left-early warning handles that case instead.
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(-5),
          tutorLastSeenMs: at(-90),
        })
      ).toBe("keep");
    });

    it("leaves the emptiness rule alone for a tutor who is merely recently gone", () => {
      expect(
        decide({
          ...occupiedByStudents,
          nowMs: at(3),
          someonePresent: false,
          tutorLastSeenMs: at(-1),
        })
      ).toBe("mark-empty");
    });
  });
});

describe("courseUsesDiscordVoiceSystem", () => {
  it("includes a course whose first class is on the cutoff", () => {
    expect(courseUsesDiscordVoiceSystem(new Date(discordVoiceSystemStartMs))).toBe(true);
  });

  it("excludes the legacy Zoom era", () => {
    expect(courseUsesDiscordVoiceSystem(new Date(discordVoiceSystemStartMs - 1))).toBe(false);
  });

  it("includes courses started well after the cutoff", () => {
    expect(courseUsesDiscordVoiceSystem(new Date("2026-08-11T00:00:00Z"))).toBe(true);
  });

  it("excludes a course with no classes, or an unusable date", () => {
    expect(courseUsesDiscordVoiceSystem(null)).toBe(false);
    expect(courseUsesDiscordVoiceSystem(new Date("not a date"))).toBe(false);
  });
});

describe("classUsesDiscordVoiceSystem", () => {
  const beforeCutoff = new Date(founderSchoolhouseEndMs - 60_000);
  const atCutoff = new Date(founderSchoolhouseEndMs);
  const afterCutoff = new Date(founderSchoolhouseEndMs + 60_000);
  const zoomEraFirstClass = new Date(discordVoiceSystemStartMs - 60_000);
  const voiceEraFirstClass = new Date(discordVoiceSystemStartMs);

  it("keeps a founder class on Schoolhouse right up to the cutoff", () => {
    expect(
      classUsesDiscordVoiceSystem({
        founderTaught: true,
        firstClassDate: zoomEraFirstClass,
        classStart: beforeCutoff,
      })
    ).toBe(false);
  });

  it("moves a founder class to Discord from the cutoff onwards", () => {
    for (const classStart of [atCutoff, afterCutoff]) {
      expect(
        classUsesDiscordVoiceSystem({
          founderTaught: true,
          firstClassDate: zoomEraFirstClass,
          classStart,
        })
      ).toBe(true);
    }
  });

  it("switches a founder course that is already under way, mid-course", () => {
    // Same course, one class either side of the cutoff.
    const firstClassDate = new Date(founderSchoolhouseEndMs - 30 * 24 * 3600 * 1000);
    expect(
      classUsesDiscordVoiceSystem({ founderTaught: true, firstClassDate, classStart: beforeCutoff })
    ).toBe(false);
    expect(
      classUsesDiscordVoiceSystem({ founderTaught: true, firstClassDate, classStart: afterCutoff })
    ).toBe(true);
  });

  it("leaves everyone else on the first-class rule the Zoom cutoff set", () => {
    // A non-founder course from the Zoom era stays off Discord even now.
    expect(
      classUsesDiscordVoiceSystem({
        founderTaught: false,
        firstClassDate: zoomEraFirstClass,
        classStart: afterCutoff,
      })
    ).toBe(false);
    expect(
      classUsesDiscordVoiceSystem({
        founderTaught: false,
        firstClassDate: voiceEraFirstClass,
        classStart: beforeCutoff,
      })
    ).toBe(true);
  });

  it("never puts a class with no start time on Discord", () => {
    expect(
      classUsesDiscordVoiceSystem({ founderTaught: true, firstClassDate: null, classStart: null })
    ).toBe(false);
  });

  it("counts a founder class as on Schoolhouse only before the cutoff", () => {
    expect(classOnSchoolhouse({ founderTaught: true, classStart: beforeCutoff })).toBe(true);
    expect(classOnSchoolhouse({ founderTaught: true, classStart: afterCutoff })).toBe(false);
    expect(classOnSchoolhouse({ founderTaught: false, classStart: beforeCutoff })).toBe(false);
  });

  it("starts at midnight in Toronto, not in UTC", () => {
    // 2026-09-08 is EDT (UTC-4), so the switch is at 04:00 UTC.
    expect(new Date(founderSchoolhouseEndMs).toISOString()).toBe("2026-09-08T04:00:00.000Z");
  });
});
