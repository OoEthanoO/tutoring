/**
 * Whether a tutor has stepped out of their live class voice channel for long
 * enough to be warned about it. Pure date math lives here (rather than the
 * class-reminders route) so it can be unit-tested.
 *
 * The policy: students should get close to the full scheduled duration, so a
 * tutor is expected to stay in the channel until at least the last 5 minutes of
 * class. Leaving before that — for longer than a single poll interval, so a
 * reconnect is not mistaken for walking out — earns one warning in the
 * executives channel.
 */

/** How long before the scheduled end a tutor may leave without being warned. */
export const tutorPresenceRequiredUntilBeforeEndMs = 5 * 60 * 1000;

/**
 * How long an absence must last before it counts. The cron polls once a minute,
 * so anything at or under one interval is indistinguishable from a blip.
 */
export const tutorAbsenceToleranceMs = 60 * 1000;

/** `class_reminder_logs.reminder_type` under which the warning is recorded. */
export const tutorLeftEarlyReminderType = "tutor_left_early";

export const shouldWarnTutorLeftEarly = ({
  nowMs,
  startsAtMs,
  endsAtMs,
  tutorLastSeenMs,
  alreadyWarned,
}: {
  nowMs: number;
  startsAtMs: number;
  endsAtMs: number;
  /**
   * When the tutor was last seen in the class voice channel, or null if they
   * were never seen there — someone who never joined has not "left early", and
   * the post-class absence follow-up covers that case instead.
   */
  tutorLastSeenMs: number | null;
  alreadyWarned: boolean;
}): boolean => {
  if (alreadyWarned || tutorLastSeenMs === null) {
    return false;
  }
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    !Number.isFinite(tutorLastSeenMs)
  ) {
    return false;
  }
  // Before the class starts the tutor is only preparing (they get the channel 15
  // minutes early), and once the last 5 minutes begin leaving is allowed.
  if (nowMs < startsAtMs || nowMs >= endsAtMs - tutorPresenceRequiredUntilBeforeEndMs) {
    return false;
  }
  // Strictly greater: "longer than a minute", not "at least a minute".
  return nowMs - tutorLastSeenMs > tutorAbsenceToleranceMs;
};
