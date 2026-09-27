import { describe, expect, it } from "vitest";
import {
  compareVersions,
  recorderConnectedWithinMs,
  recorderStateLabel,
  summarizeTutorRecorders,
  type RecorderSessionRow,
} from "./recorderPresence";

const nowMs = Date.UTC(2026, 8, 27, 0, 0, 0);
const ago = (seconds: number) => new Date(nowMs - seconds * 1000).toISOString();
const session = (overrides: Partial<RecorderSessionRow>): RecorderSessionRow => ({
  tutor_id: "t1",
  device_id: "d1",
  device_name: "Jaden's MacBook",
  platform: "macos",
  app_version: "0.5.5",
  last_state: "idle",
  current_class_id: null,
  last_seen_at: ago(10),
  ...overrides,
});
const tutors = [
  { id: "t1", name: "Jaden Fu", email: "jaden@example.test" },
  { id: "t2", name: "Ann Lee", email: "ann@example.test" },
  { id: "t3", name: "Bo Chen", email: "bo@example.test" },
];

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.5.10", "0.5.9")).toBe(1);
    expect(compareVersions("0.5.4", "0.5.5")).toBe(-1);
    expect(compareVersions("0.5.5", "0.5.5")).toBe(0);
    expect(compareVersions("v0.6", "0.5.9")).toBe(1);
  });

  it("treats an unreadable version as oldest, never as up to date", () => {
    expect(compareVersions("", "0.5.5")).toBe(-1);
    expect(compareVersions(null, "0.5.5")).toBe(-1);
  });
});

describe("recorderStateLabel", () => {
  it("names each state the recorder reports", () => {
    expect(recorderStateLabel("recording")).toBe("Recording");
    expect(recorderStateLabel("paused_manual")).toBe("Paused by the tutor");
    expect(recorderStateLabel("paused")).toBe("In class, not recording");
    expect(recorderStateLabel(null)).toBe("Idle");
  });
});

describe("summarizeTutorRecorders", () => {
  it("counts a recorder heard from within 90 seconds as connected", () => {
    const [row] = summarizeTutorRecorders({
      tutors: tutors.slice(0, 1),
      sessions: [session({ last_seen_at: ago(recorderConnectedWithinMs / 1000 - 1) })],
      nowMs,
      latestVersion: "0.5.5",
    });
    expect(row.connected).toBe(true);
  });

  it("does not count a recorder that stopped checking in", () => {
    const [row] = summarizeTutorRecorders({
      tutors: tutors.slice(0, 1),
      sessions: [session({ last_seen_at: ago(600) })],
      nowMs,
      latestVersion: "0.5.5",
    });
    expect(row.connected).toBe(false);
    expect(row.lastSeenAt).toBe(ago(600));
  });

  it("lists tutors who never signed in, with no devices", () => {
    const rows = summarizeTutorRecorders({ tutors, sessions: [session({})], nowMs, latestVersion: "0.5.5" });
    const never = rows.find((row) => row.tutorId === "t3");
    expect(never?.devices).toEqual([]);
    expect(never?.lastSeenAt).toBeNull();
  });

  it("flags a recorder older than the latest release", () => {
    const [row] = summarizeTutorRecorders({
      tutors: tutors.slice(0, 1),
      sessions: [session({ app_version: "0.5.3" })],
      nowMs,
      latestVersion: "0.5.5",
    });
    expect(row.outdated).toBe(true);
    expect(row.devices[0].appVersion).toBe("0.5.3");
  });

  it("flags nothing when the latest release is unknown", () => {
    const [row] = summarizeTutorRecorders({
      tutors: tutors.slice(0, 1),
      sessions: [session({ app_version: "0.5.3" })],
      nowMs,
      latestVersion: null,
    });
    expect(row.outdated).toBe(false);
  });

  it("judges a tutor with two computers by the one that is connected", () => {
    const [row] = summarizeTutorRecorders({
      tutors: tutors.slice(0, 1),
      sessions: [
        session({ device_id: "old", app_version: "0.5.1", last_seen_at: ago(86400) }),
        session({ device_id: "new", app_version: "0.5.5", last_seen_at: ago(5), last_state: "recording" }),
      ],
      nowMs,
      latestVersion: "0.5.5",
    });
    expect(row.connected).toBe(true);
    expect(row.outdated).toBe(false);
    expect(row.devices[0].stateLabel).toBe("Recording");
    expect(row.devices).toHaveLength(2);
  });

  it("puts connected tutors first, then the most recently seen, then never", () => {
    const rows = summarizeTutorRecorders({
      tutors,
      sessions: [
        session({ tutor_id: "t2", last_seen_at: ago(5) }),
        session({ tutor_id: "t1", last_seen_at: ago(3600) }),
      ],
      nowMs,
      latestVersion: "0.5.5",
    });
    expect(rows.map((row) => row.tutorId)).toEqual(["t2", "t1", "t3"]);
  });
});
