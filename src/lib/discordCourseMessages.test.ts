import { describe, expect, it } from "vitest";
import {
  buildCourseConcludedDiscordMessage,
  buildRecordingReadyDiscordMessage,
  discordTimestamp,
  findDiscordCourseMessageTarget,
} from "@/lib/discordCourseMessages";

describe("findDiscordCourseMessageTarget", () => {
  const roles = [
    { id: "founder" },
    { id: "course-role" },
    { id: "bot", managed: true },
  ];

  it("finds the channel by course topic and its Manage Channels role", () => {
    expect(
      findDiscordCourseMessageTarget({
        courseId: "course-42",
        guildId: "guild",
        roles,
        channels: [
          {
            id: "channel",
            type: 0,
            topic: "yanlearn-course-id:course-42|w",
            permission_overwrites: [
              { id: "guild", type: 0, allow: "0" },
              { id: "founder", type: 0, allow: "68608" },
              { id: "course-role", type: 0, allow: "68624" },
              { id: "bot", type: 1, allow: "68624" },
            ],
          },
        ],
      })
    ).toEqual({ channelId: "channel", roleId: "course-role" });
  });

  it("does not match another course or a channel without a course role", () => {
    expect(
      findDiscordCourseMessageTarget({
        courseId: "course-42",
        guildId: "guild",
        roles,
        channels: [
          {
            id: "other",
            type: 0,
            topic: "yanlearn-course-id:course-420",
            permission_overwrites: [{ id: "course-role", type: 0, allow: "68624" }],
          },
          {
            id: "no-course-role",
            type: 0,
            topic: "yanlearn-course-id:course-42",
            permission_overwrites: [{ id: "founder", type: 0, allow: "68608" }],
          },
        ],
      })
    ).toBeNull();
  });
});

describe("buildRecordingReadyDiscordMessage", () => {
  it("mentions only the resolved role and links to My classes", () => {
    const message = buildRecordingReadyDiscordMessage({
      roleId: "123",
      classTitle: "Class *9*",
      siteUrl: "https://learn.ethanyanxu.com",
    });

    expect(message).toContain("<@&123>");
    expect(message).toContain("Class \\*9\\*");
    expect(message).toContain("https://learn.ethanyanxu.com/?menu=my_classes");
  });
});

describe("discordTimestamp", () => {
  const atMs = Date.UTC(2026, 8, 19, 20, 0, 0);

  it("counts in whole seconds, not milliseconds", () => {
    expect(discordTimestamp(atMs, "F")).toBe(`<t:${atMs / 1000}:F>`);
  });

  it("floors a fractional second rather than sending a decimal", () => {
    expect(discordTimestamp(atMs + 999, "R")).toBe(`<t:${atMs / 1000}:R>`);
  });

  it("has nothing to render for a time that is not a time", () => {
    expect(discordTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(discordTimestamp(Number.NaN)).toBeNull();
  });
});

describe("buildCourseConcludedDiscordMessage", () => {
  const deletionAtMs = Date.UTC(2026, 8, 19, 20, 0, 0);
  const seconds = deletionAtMs / 1000;

  it("gives the deadline as both an exact date and a countdown", () => {
    const message = buildCourseConcludedDiscordMessage({ roleId: "42", deletionAtMs });
    expect(message).toContain(`**Deletion Date:** <t:${seconds}:F> (<t:${seconds}:R>)`);
  });

  it("pings the course role and says what happens", () => {
    const message = buildCourseConcludedDiscordMessage({ roleId: "42", deletionAtMs });
    expect(message).toContain("<@&42>");
    expect(message).toContain("permanently deleted");
  });

  it("falls back to the old wording rather than printing a broken timestamp", () => {
    const message = buildCourseConcludedDiscordMessage({
      roleId: "42",
      deletionAtMs: Number.POSITIVE_INFINITY,
    });
    expect(message).toContain("**Deletion Date:** in 7 days");
    expect(message).not.toContain("<t:");
  });
});
