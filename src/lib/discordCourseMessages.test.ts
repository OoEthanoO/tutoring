import { describe, expect, it } from "vitest";
import {
  buildRecordingReadyDiscordMessage,
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
