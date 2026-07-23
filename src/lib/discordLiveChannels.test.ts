import { describe, expect, it } from "vitest";
import {
  buildLiveVoicePermissionOverwrites,
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
