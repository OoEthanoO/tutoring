/**
 * Rules for the YanLearn Recorder desktop app, kept as pure functions so the
 * server (tick endpoint, cron compliance check) and the tests agree on them.
 * The desktop client mirrors the same numbers in recorder/src/policy.js.
 */

/** From this date every class must be recorded with YanLearn Recorder. */
export const recorderMandatoryFromMs = new Date("2026-09-09T00:00:00-04:00").getTime();

/** The recorder must be open (signed in and heart-beating) this long before the start. */
export const recorderRequiredOpenBeforeStartMs = 5 * 60 * 1000;

/**
 * How early the tick endpoint starts reporting a class to the recorder. Wider
 * than the 5-minute lock window so the client can pre-arm (display choice,
 * ffmpeg probe) before the lock engages.
 */
export const recorderPreArmBeforeStartMs = 15 * 60 * 1000;

/**
 * Safety valve: a class whose live channel never appears (or whose deletion the
 * cron never records) is still released this long after its scheduled end, so
 * a tutor is never locked into the app forever.
 */
export const recorderMaxHoldAfterEndMs = 3 * 60 * 60 * 1000;

/** Recordings are deleted this long after they finish uploading. */
export const recordingRetentionMs = 7 * 24 * 60 * 60 * 1000;

/** Poll cadence the tick endpoint asks the client for. */
export const recorderActivePollMs = 2000;
export const recorderIdlePollMs = 30000;

/** `class_reminder_logs.reminder_type` for the "recorder was not open" warning. */
export const recorderNotOpenReminderType = "recorder_not_open";

export const isRecorderMandatory = (startsAtMs: number): boolean =>
  Number.isFinite(startsAtMs) && startsAtMs >= recorderMandatoryFromMs;

export type RecorderPhase = "pre_arm" | "armed" | "live" | "after_end";

/**
 * Where a class sits relative to the recorder's timeline, or null when the
 * recorder has nothing to do with it right now.
 *
 *  - pre_arm: 15 to 5 minutes before the start (client prepares, may still quit)
 *  - armed: within 5 minutes of the start (quit locked, not yet recording)
 *  - live: between the start and the end (recording while the tutor is in the call)
 *  - after_end: past the end but not released yet (waiting for "class done" or
 *    for the live channel to be deleted)
 */
export const recorderPhase = ({
  nowMs,
  startsAtMs,
  endsAtMs,
  released,
}: {
  nowMs: number;
  startsAtMs: number;
  endsAtMs: number;
  /** The recorder is finished with this class (uploaded, or nothing to upload). */
  released: boolean;
}): RecorderPhase | null => {
  if (
    released ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs)
  ) {
    return null;
  }
  if (nowMs < startsAtMs - recorderPreArmBeforeStartMs) {
    return null;
  }
  if (nowMs < startsAtMs - recorderRequiredOpenBeforeStartMs) {
    return "pre_arm";
  }
  if (nowMs < startsAtMs) {
    return "armed";
  }
  if (nowMs < endsAtMs) {
    return "live";
  }
  if (nowMs < endsAtMs + recorderMaxHoldAfterEndMs) {
    return "after_end";
  }
  return null;
};

/** Whether the tutor may quit the recorder in this phase. */
export const recorderQuitLocked = (phase: RecorderPhase | null): boolean =>
  phase === "armed" || phase === "live" || phase === "after_end";

/**
 * Whether the recorder must finalize (upload whatever it has) right now: the
 * live voice channel is gone, so the tutor cannot go back and teach.
 */
export const recorderMustFinalize = ({
  phase,
  liveChannelDeleted,
}: {
  phase: RecorderPhase | null;
  /** The class's live channel existed and has since been deleted. */
  liveChannelDeleted: boolean;
}): boolean => (phase === "live" || phase === "after_end") && liveChannelDeleted;

export type RecorderCompliance = "ok" | "late" | "missing";

/**
 * Whether the recorder was open in time for a class. `firstSeenMs` is when the
 * server first heard from the tutor's recorder about this class.
 */
export const recorderCompliance = ({
  startsAtMs,
  firstSeenMs,
}: {
  startsAtMs: number;
  firstSeenMs: number | null;
}): RecorderCompliance => {
  if (firstSeenMs === null || !Number.isFinite(firstSeenMs)) {
    return "missing";
  }
  return firstSeenMs <= startsAtMs - recorderRequiredOpenBeforeStartMs ? "ok" : "late";
};

/**
 * Whether to warn the executives that a tutor's recorder was not open in time.
 * Fires once per class, at the class start, only once the tool is mandatory.
 */
export const shouldWarnRecorderNotOpen = ({
  nowMs,
  startsAtMs,
  firstSeenMs,
  alreadyWarned,
  tickIntervalMs,
}: {
  nowMs: number;
  startsAtMs: number;
  firstSeenMs: number | null;
  alreadyWarned: boolean;
  /** How far back this tick looks, so a class start is never skipped between ticks. */
  tickIntervalMs: number;
}): boolean => {
  if (alreadyWarned || !isRecorderMandatory(startsAtMs)) {
    return false;
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(startsAtMs)) {
    return false;
  }
  // Only in the tick that contains the start time.
  if (nowMs < startsAtMs || nowMs - startsAtMs > tickIntervalMs) {
    return false;
  }
  return recorderCompliance({ startsAtMs, firstSeenMs }) !== "ok";
};

/** When a recording that finished uploading at `uploadedAtMs` is deleted. */
export const recordingExpiresAtMs = (uploadedAtMs: number): number =>
  uploadedAtMs + recordingRetentionMs;

/**
 * Which class the recorder should be working on, given every class the tutor
 * teaches: the earliest one that is in any active phase. Classes the recorder
 * has already released are skipped by `recorderPhase`.
 */
export const pickActiveRecorderClass = <
  T extends { startsAtMs: number; endsAtMs: number; released: boolean },
>(
  nowMs: number,
  classes: T[]
): { classRow: T; phase: RecorderPhase } | null => {
  let best: { classRow: T; phase: RecorderPhase } | null = null;
  for (const classRow of classes) {
    const phase = recorderPhase({
      nowMs,
      startsAtMs: classRow.startsAtMs,
      endsAtMs: classRow.endsAtMs,
      released: classRow.released,
    });
    if (!phase) {
      continue;
    }
    if (!best || classRow.startsAtMs < best.classRow.startsAtMs) {
      best = { classRow, phase };
    }
  }
  return best;
};
