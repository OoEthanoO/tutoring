import { describe, expect, it } from "vitest";
import {
  shouldWarnTutorLeftEarly,
  tutorAbsenceToleranceMs,
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
