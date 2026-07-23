import { describe, expect, it } from "vitest";
import {
  formatDiscordTimestamp,
  formatDiscordTimestampWithRelative,
} from "@/lib/discordTimestamp";

describe("formatDiscordTimestamp", () => {
  it("converts an ISO string to Discord timestamp markup", () => {
    expect(formatDiscordTimestamp("2026-01-01T10:00:00Z")).toBe(
      `<t:${Date.UTC(2026, 0, 1, 10) / 1000}:F>`
    );
  });

  it("supports other styles", () => {
    expect(formatDiscordTimestamp("2026-01-01T10:00:00Z", "R")).toMatch(
      /^<t:\d+:R>$/
    );
  });

  it("accepts Date and epoch-milliseconds inputs", () => {
    const date = new Date("2026-01-01T10:00:00Z");
    expect(formatDiscordTimestamp(date)).toBe(
      formatDiscordTimestamp(date.getTime())
    );
  });

  it("truncates sub-second precision", () => {
    expect(formatDiscordTimestamp("2026-01-01T10:00:00.900Z")).toBe(
      formatDiscordTimestamp("2026-01-01T10:00:00Z")
    );
  });

  it("falls back to the raw value when unparseable", () => {
    expect(formatDiscordTimestamp("garbage")).toBe("garbage");
  });
});

describe("formatDiscordTimestampWithRelative", () => {
  it("combines absolute and relative styles", () => {
    const seconds = Date.UTC(2026, 0, 1, 10) / 1000;
    expect(formatDiscordTimestampWithRelative("2026-01-01T10:00:00Z")).toBe(
      `<t:${seconds}:F> (<t:${seconds}:R>)`
    );
  });

  it("falls back to the raw value when unparseable", () => {
    expect(formatDiscordTimestampWithRelative("garbage")).toBe("garbage");
  });
});
