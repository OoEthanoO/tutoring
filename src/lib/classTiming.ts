/**
 * When a class ends, derived from `course_classes.duration_hours`.
 *
 * Durations are entered in whole minutes but stored as hours in a
 * `numeric(4,2)` column, so anything that is not a multiple of 0.6 minutes
 * round-trips lossily: 80 minutes is written as 80 / 60 = 1.3333... and read
 * back as 1.33, i.e. 79.8 minutes. Adding those raw hours to the start time
 * lands 12 seconds early and renders as "7:00 PM - 8:19 PM (80 min)" — the
 * minute count (rounded) and the end time (truncated) disagree.
 *
 * Snapping the duration to whole minutes before doing any arithmetic fixes
 * that: it recovers the number the tutor actually typed, and every end time
 * derived from it agrees with the minute count shown next to it.
 */

/** Duration of a class in whole minutes. Unusable values count as one hour. */
export const classDurationMinutes = (durationHours: unknown): number => {
  const parsed =
    typeof durationHours === "number"
      ? durationHours
      : Number.parseFloat(String(durationHours ?? ""));
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return Math.round(safe * 60);
};

/** Duration of a class in milliseconds, snapped to whole minutes. */
export const classDurationMs = (durationHours: unknown): number =>
  classDurationMinutes(durationHours) * 60 * 1000;

/** Epoch ms at which a class starting at `startMs` ends. */
export const classEndMs = (startMs: number, durationHours: unknown): number =>
  startMs + classDurationMs(durationHours);

/** `Date` at which a class starting at `startsAt` ends. */
export const classEndDate = (startsAt: Date, durationHours: unknown): Date =>
  new Date(classEndMs(startsAt.getTime(), durationHours));
