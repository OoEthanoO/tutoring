import { describe, expect, it } from "vitest";
import { canStillJoinVoice, trialGuestsForClass, trialStatus, trialWindow, withTrialOverwrites, type ClassTrial } from "./classTrials";
import { buildLiveVoicePermissionOverwrites } from "./discordLiveChannels";

const starts = Date.parse("2026-10-01T18:00:00Z");
const trial: ClassTrial = { id: "trial", class_id: "class", discord_user_id: "guest", student_name: "Alice", created_at: "2026-09-26T00:00:00Z", revoked_at: null,
  lesson: { id: "class", course_id: "course", title: "Class 1", starts_at: new Date(starts).toISOString(), duration_hours: 1.33,
    course: { id: "course", title: "French", deleted_at: null, is_completed: false } } };
const base = buildLiveVoicePermissionOverwrites({ guildId: "guild", botUserId: "bot", tutorDiscordUserId: "tutor", ceoRoleId: null, cooRoleId: null, courseRoleId: "course-role" });

describe("trial access", () => {
  it("uses rounded class duration and exact student opening/expiry boundaries", () => {
    expect(trialWindow(trial.lesson)).toEqual({ opensAtMs: starts - 5 * 60_000, expiresAtMs: starts + 110 * 60_000 });
    expect(trialStatus(trial, starts - 5 * 60_000 - 1)).toBe("scheduled");
    expect(trialStatus(trial, starts - 5 * 60_000)).toBe("open");
    expect(trialStatus(trial, starts + 110 * 60_000)).toBe("expired");
  });
  it("scopes a guest to one class, not every class taught by the tutor", () => {
    expect(trialGuestsForClass([trial], "class", starts)).toEqual(["guest"]);
    expect(trialGuestsForClass([trial], "another-class", starts)).toEqual([]);
    expect(trialGuestsForClass([{ ...trial, revoked_at: new Date(starts).toISOString() }], "class", starts)).toEqual([]);
  });
  it("withdraws access for deleted, completed or unreadable classes", () => {
    expect(trialStatus({ ...trial, lesson: null }, starts)).toBe("expired");
    expect(trialStatus({ ...trial, lesson: { ...trial.lesson!, course: { ...trial.lesson!.course!, deleted_at: "now" } } }, starts)).toBe("expired");
    expect(trialStatus({ ...trial, lesson: { ...trial.lesson!, starts_at: "bad date" } }, starts)).toBe("expired");
  });
  it("removes obsolete trial entries without changing tutor/bot/course-role access", () => {
    const withGuest = withTrialOverwrites(base, new Set(["guest", "bot"]), ["guest", "bot"], "voice", new Set(["bot"]));
    expect(withGuest).toContainEqual({ id: "guest", type: 1, allow: "3146752", deny: "0" });
    expect(withTrialOverwrites(withGuest, new Set(["guest", "bot"]), [], "voice", new Set(["bot"]))).toEqual(base);
  });
  it("keeps normal enrollment/leadership access after a trial expires", () => {
    const roles = [{ id: "guild", permissions: "0" }, { id: "admin", permissions: "8" }];
    expect(canStillJoinVoice("guest", new Set(), roles, "guild", base)).toBe(false);
    expect(canStillJoinVoice("guest", new Set(["course-role"]), roles, "guild", base)).toBe(true);
    expect(canStillJoinVoice("guest", new Set(["admin"]), roles, "guild", base)).toBe(true);
    expect(canStillJoinVoice("tutor", new Set(), roles, "guild", base)).toBe(true);
  });
  it("includes trials in newly created channels and never duplicates the bot or tutor", () => {
    const entries = buildLiveVoicePermissionOverwrites({ guildId: "guild", botUserId: "bot", tutorDiscordUserId: "tutor", ceoRoleId: null, cooRoleId: null, courseRoleId: null, trialDiscordUserIds: ["guest", "guest", "bot", "tutor"] });
    expect(entries).toHaveLength(4);
    expect(entries.find(o => o.id === "bot")?.allow).toBe(String(3146752 | 16));
  });
});
