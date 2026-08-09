import { describe, expect, it } from "vitest";
import {
  shouldWarnTutorLeftEarly,
  tutorAbsenceToleranceMs,
  tutorExpectedJoinBeforeStartMs,
  tutorJoinWarning,
  tutorLateWarningAfterStartMs,
  tutorPresenceRequiredUntilBeforeEndMs,
} from "./tutorPresence";

const startsAtMs = new Date("2026-08-16T19:00:00Z").getTime();
const endsAtMs = startsAtMs + 80 * 60 * 1000; // an 80-minute class
const lastFiveMinutesMs = endsAtMs - tutorPresenceRequiredUntilBeforeEndMs;

const warn = (overrides: Partial<Parameters<typeof shouldWarnTutorLeftEarly>[0]>) =>
  shouldWarnTutorLeftEarly({
    nowMs: startsAtMs + 30 * 60 * 1000,
    startsAtMs,
    endsAtMs,
    tutorLastSeenMs: startsAtMs + 28 * 60 * 1000,
    alreadyWarned: false,
    ...overrides,
  });

describe("shouldWarnTutorLeftEarly", () => {
  it("warns when the tutor has been gone for longer than a minute mid-class", () => {
    expect(warn({})).toBe(true);
  });

  it("tolerates an absence of exactly the poll interval", () => {
    const nowMs = startsAtMs + 30 * 60 * 1000;
    expect(warn({ nowMs, tutorLastSeenMs: nowMs - tutorAbsenceToleranceMs })).toBe(false);
    expect(warn({ nowMs, tutorLastSeenMs: nowMs - tutorAbsenceToleranceMs - 1 })).toBe(true);
  });

  it("does not warn once the last 5 minutes have begun", () => {
    expect(warn({ nowMs: lastFiveMinutesMs })).toBe(false);
    expect(warn({ nowMs: lastFiveMinutesMs - 1 })).toBe(true);
    expect(warn({ nowMs: endsAtMs + 60 * 1000 })).toBe(false);
  });

  it("does not warn before the class has started", () => {
    // The tutor gets the channel 15 minutes early to prepare; stepping out then
    // is not leaving class early.
    expect(warn({ nowMs: startsAtMs - 60 * 1000, tutorLastSeenMs: startsAtMs - 10 * 60 * 1000 })).toBe(
      false
    );
    expect(warn({ nowMs: startsAtMs, tutorLastSeenMs: startsAtMs - 10 * 60 * 1000 })).toBe(true);
  });

  it("does not warn about a tutor who was never seen in the channel", () => {
    expect(warn({ tutorLastSeenMs: null })).toBe(false);
  });

  it("warns only once per class", () => {
    expect(warn({ alreadyWarned: true })).toBe(false);
  });

  it("stays quiet when a timestamp is unusable", () => {
    expect(warn({ endsAtMs: Number.NaN })).toBe(false);
    expect(warn({ startsAtMs: Number.NaN })).toBe(false);
    expect(warn({ tutorLastSeenMs: Number.NaN })).toBe(false);
  });

  it("uses the real end time, so a longer class is protected for longer", () => {
    // 20 minutes in is mid-class for an 80-minute class but inside the last 5
    // minutes of a 60-minute one that started at the same time... and 56 minutes
    // in is the reverse case: fine for the long class, allowed for the short one.
    const shortEndsAtMs = startsAtMs + 60 * 60 * 1000;
    const nowMs = startsAtMs + 56 * 60 * 1000;
    expect(warn({ nowMs })).toBe(true);
    expect(warn({ nowMs, endsAtMs: shortEndsAtMs })).toBe(false);
  });
});

const joinWarn = (overrides: Partial<Parameters<typeof tutorJoinWarning>[0]>) =>
  tutorJoinWarning({
    nowMs: startsAtMs - 60 * 1000,
    startsAtMs,
    endsAtMs,
    tutorEverJoined: false,
    warnedNotJoined: false,
    warnedStillNotJoined: false,
    ...overrides,
  });

describe("tutorJoinWarning", () => {
  it("nudges a missing tutor inside the last 5 minutes before the start", () => {
    expect(joinWarn({ nowMs: startsAtMs - tutorExpectedJoinBeforeStartMs })).toBe("join_soon");
    expect(joinWarn({ nowMs: startsAtMs - 1000 })).toBe("join_soon");
  });

  it("stays quiet earlier than that", () => {
    expect(joinWarn({ nowMs: startsAtMs - tutorExpectedJoinBeforeStartMs - 1 })).toBe(null);
    // The channel opens 15 minutes early, but not being in it yet is fine then.
    expect(joinWarn({ nowMs: startsAtMs - 15 * 60 * 1000 })).toBe(null);
  });

  it("says nothing between the start and the late threshold", () => {
    expect(joinWarn({ nowMs: startsAtMs })).toBe(null);
    expect(joinWarn({ nowMs: startsAtMs + tutorLateWarningAfterStartMs - 1 })).toBe(null);
  });

  it("escalates once the tutor is 5 minutes late", () => {
    expect(joinWarn({ nowMs: startsAtMs + tutorLateWarningAfterStartMs })).toBe("late");
    expect(joinWarn({ nowMs: startsAtMs + 40 * 60 * 1000 })).toBe("late");
  });

  it("escalates even if the earlier nudge was never sent", () => {
    expect(
      joinWarn({ nowMs: startsAtMs + tutorLateWarningAfterStartMs, warnedNotJoined: false })
    ).toBe("late");
  });

  it("sends each warning once", () => {
    expect(joinWarn({ nowMs: startsAtMs - 60 * 1000, warnedNotJoined: true })).toBe(null);
    expect(
      joinWarn({
        nowMs: startsAtMs + tutorLateWarningAfterStartMs,
        warnedStillNotJoined: true,
      })
    ).toBe(null);
    // A sent nudge does not suppress the later escalation.
    expect(
      joinWarn({ nowMs: startsAtMs + tutorLateWarningAfterStartMs, warnedNotJoined: true })
    ).toBe("late");
  });

  it("says nothing about a tutor who did join — that is the left-early case", () => {
    expect(joinWarn({ nowMs: startsAtMs - 60 * 1000, tutorEverJoined: true })).toBe(null);
    expect(
      joinWarn({ nowMs: startsAtMs + tutorLateWarningAfterStartMs, tutorEverJoined: true })
    ).toBe(null);
  });

  it("stops once the class is over", () => {
    expect(joinWarn({ nowMs: endsAtMs })).toBe(null);
    expect(joinWarn({ nowMs: endsAtMs - 1000 })).toBe("late");
  });

  it("stays quiet when a timestamp is unusable", () => {
    expect(joinWarn({ startsAtMs: Number.NaN })).toBe(null);
    expect(joinWarn({ endsAtMs: Number.NaN })).toBe(null);
  });
});
