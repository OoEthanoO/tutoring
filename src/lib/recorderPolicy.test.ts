import { describe, expect, it } from "vitest";
import {
  isRecorderMandatory,
  pickActiveRecorderClass,
  recorderCompliance,
  recorderMandatoryFromMs,
  recorderMaxHoldAfterEndMs,
  recorderMustFinalize,
  recorderPhase,
  recorderQuitLocked,
  recordingExpiresAtMs,
  recordingRetentionMs,
  shouldWarnRecorderNotOpen,
} from "./recorderPolicy";

const minute = 60 * 1000;
const start = Date.UTC(2026, 8, 10, 18, 0, 0);
const end = start + 60 * minute;

describe("recorderPhase", () => {
  const phaseAt = (nowMs: number, released = false) =>
    recorderPhase({ nowMs, startsAtMs: start, endsAtMs: end, released });

  it("is idle more than 15 minutes before the start", () => {
    expect(phaseAt(start - 16 * minute)).toBeNull();
  });

  it("pre-arms between 15 and 5 minutes before the start", () => {
    expect(phaseAt(start - 15 * minute)).toBe("pre_arm");
    expect(phaseAt(start - 5 * minute - 1)).toBe("pre_arm");
  });

  it("arms (and locks quitting) inside the last 5 minutes", () => {
    expect(phaseAt(start - 5 * minute)).toBe("armed");
    expect(phaseAt(start - 1)).toBe("armed");
  });

  it("is live from the start until the end", () => {
    expect(phaseAt(start)).toBe("live");
    expect(phaseAt(end - 1)).toBe("live");
  });

  it("holds after the end until the safety valve", () => {
    expect(phaseAt(end)).toBe("after_end");
    expect(phaseAt(end + recorderMaxHoldAfterEndMs - 1)).toBe("after_end");
    expect(phaseAt(end + recorderMaxHoldAfterEndMs)).toBeNull();
  });

  it("is idle once the class has been released", () => {
    expect(phaseAt(start + 10 * minute, true)).toBeNull();
  });
});

describe("recorderQuitLocked", () => {
  it("locks from armed through after_end only", () => {
    expect(recorderQuitLocked(null)).toBe(false);
    expect(recorderQuitLocked("pre_arm")).toBe(false);
    expect(recorderQuitLocked("armed")).toBe(true);
    expect(recorderQuitLocked("live")).toBe(true);
    expect(recorderQuitLocked("after_end")).toBe(true);
  });
});

describe("recorderMustFinalize", () => {
  it("forces the upload once the live channel is gone during or after the class", () => {
    expect(recorderMustFinalize({ phase: "live", liveChannelDeleted: true })).toBe(true);
    expect(recorderMustFinalize({ phase: "after_end", liveChannelDeleted: true })).toBe(true);
  });

  it("never forces before the class starts or while the channel exists", () => {
    expect(recorderMustFinalize({ phase: "armed", liveChannelDeleted: true })).toBe(false);
    expect(recorderMustFinalize({ phase: "live", liveChannelDeleted: false })).toBe(false);
  });
});

describe("recorderCompliance", () => {
  it("is ok when the recorder was seen at least 5 minutes early", () => {
    expect(recorderCompliance({ startsAtMs: start, firstSeenMs: start - 5 * minute })).toBe("ok");
    expect(recorderCompliance({ startsAtMs: start, firstSeenMs: start - 20 * minute })).toBe("ok");
  });

  it("is late when the recorder was opened inside the last 5 minutes", () => {
    expect(recorderCompliance({ startsAtMs: start, firstSeenMs: start - 4 * minute })).toBe("late");
  });

  it("is missing when the recorder was never seen", () => {
    expect(recorderCompliance({ startsAtMs: start, firstSeenMs: null })).toBe("missing");
  });
});

describe("shouldWarnRecorderNotOpen", () => {
  const base = { startsAtMs: start, alreadyWarned: false, tickIntervalMs: minute };

  it("warns in the tick containing the start when the recorder was late or missing", () => {
    expect(shouldWarnRecorderNotOpen({ ...base, nowMs: start, firstSeenMs: null })).toBe(true);
    expect(
      shouldWarnRecorderNotOpen({ ...base, nowMs: start + 30 * 1000, firstSeenMs: start - minute })
    ).toBe(true);
  });

  it("does not warn when the recorder was open in time", () => {
    expect(
      shouldWarnRecorderNotOpen({ ...base, nowMs: start, firstSeenMs: start - 6 * minute })
    ).toBe(false);
  });

  it("does not warn outside the start tick or twice", () => {
    expect(shouldWarnRecorderNotOpen({ ...base, nowMs: start - 1, firstSeenMs: null })).toBe(false);
    expect(
      shouldWarnRecorderNotOpen({ ...base, nowMs: start + 2 * minute, firstSeenMs: null })
    ).toBe(false);
    expect(
      shouldWarnRecorderNotOpen({ ...base, nowMs: start, firstSeenMs: null, alreadyWarned: true })
    ).toBe(false);
  });

  it("does not warn before the tool is mandatory", () => {
    const early = recorderMandatoryFromMs - 24 * 60 * minute;
    expect(
      shouldWarnRecorderNotOpen({ ...base, startsAtMs: early, nowMs: early, firstSeenMs: null })
    ).toBe(false);
    expect(isRecorderMandatory(early)).toBe(false);
    expect(isRecorderMandatory(recorderMandatoryFromMs)).toBe(true);
  });
});

describe("recordingExpiresAtMs", () => {
  it("keeps recordings for exactly 7 days", () => {
    expect(recordingRetentionMs).toBe(7 * 24 * 60 * minute);
    expect(recordingExpiresAtMs(start)).toBe(start + 7 * 24 * 60 * minute);
  });
});

describe("pickActiveRecorderClass", () => {
  it("picks the earliest class in an active phase and skips released ones", () => {
    const classes = [
      { id: "later", startsAtMs: start + 30 * minute, endsAtMs: end + 30 * minute, released: false },
      { id: "now", startsAtMs: start, endsAtMs: end, released: false },
      { id: "done", startsAtMs: start - 10 * minute, endsAtMs: end, released: true },
    ];
    const picked = pickActiveRecorderClass(start + 5 * minute, classes);
    expect(picked?.classRow.id).toBe("now");
    expect(picked?.phase).toBe("live");
  });

  it("returns null when nothing is active", () => {
    expect(
      pickActiveRecorderClass(start - 60 * minute, [
        { startsAtMs: start, endsAtMs: end, released: false },
      ])
    ).toBeNull();
  });
});
