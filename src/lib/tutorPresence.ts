/**
 * When a tutor's presence in their live class voice channel is off-policy, and
 * which warning that earns. Pure date math lives here (rather than the
 * class-reminders route) so it can be unit-tested.
 *
 * Students have a rule of their own at the bottom of this file: they are
 * expected in the channel 5 minutes before the start, so a room with nobody in
 * it at the start time earns a nudge in the course channel.
 *
 * The tutor policy has two halves:
 *
 *  - Show up. The channel opens 15 minutes before the start, the tutor is
 *    expected in it 5 minutes before, and a tutor still missing 5 minutes after
 *    the start gets a sharper warning naming the consequence.
 *  - Stay. Students should get close to the full scheduled duration, so leaving
 *    before the last 5 minutes — for longer than a single poll interval, so a
 *    reconnect is not mistaken for walking out — earns a warning too.
 *
 * Every warning goes to the executives channel, once per class.
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

/** The channel opens this far ahead; the tutor should be in it by then. */
export const tutorIdealJoinBeforeStartMs = 15 * 60 * 1000;

/** The latest a tutor should join without being nudged. */
export const tutorExpectedJoinBeforeStartMs = 5 * 60 * 1000;

/** How far past the start an absent tutor gets the sharper warning. */
export const tutorLateWarningAfterStartMs = 5 * 60 * 1000;

/**
 * How far past the start a still-absent tutor is told a strike follows. Nothing
 * here applies that strike — a founder does, from Manage accounts — so this is
 * only the number quoted in the warning.
 */
export const tutorStrikeDeadlineAfterStartMs = 10 * 60 * 1000;

export const tutorNotJoinedReminderType = "tutor_not_joined";
export const tutorStillNotJoinedReminderType = "tutor_still_not_joined";

export type TutorJoinWarning = "join_soon" | "late" | null;

/**
 * Which no-show warning a tutor is due, if any.
 *
 * Only for a tutor who has never been seen in this class's channel: one who
 * joined and then left is the left-early case above, and warning them for not
 * joining would be wrong.
 */
export const tutorJoinWarning = ({
  nowMs,
  startsAtMs,
  endsAtMs,
  tutorEverJoined,
  warnedNotJoined,
  warnedStillNotJoined,
}: {
  nowMs: number;
  startsAtMs: number;
  endsAtMs: number;
  tutorEverJoined: boolean;
  warnedNotJoined: boolean;
  warnedStillNotJoined: boolean;
}): TutorJoinWarning => {
  if (
    tutorEverJoined ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs)
  ) {
    return null;
  }

  // Past the scheduled end there is nothing left to join; the post-class
  // absence follow-up covers what happened.
  if (nowMs >= endsAtMs) {
    return null;
  }

  if (nowMs >= startsAtMs + tutorLateWarningAfterStartMs) {
    return warnedStillNotJoined ? null : "late";
  }

  // Between the start and the late threshold, the pre-class warning has already
  // been sent and the sharper one is not due yet.
  if (nowMs >= startsAtMs) {
    return null;
  }

  if (nowMs >= startsAtMs - tutorExpectedJoinBeforeStartMs) {
    return warnedNotJoined ? null : "join_soon";
  }

  return null;
};

/** How early students are expected in the channel. */
export const studentsExpectedJoinBeforeStartMs = 5 * 60 * 1000;

/**
 * How long after the start the nudge can still go out. Past this the class is
 * underway (or was never going to happen) and a "join now" ping is just noise.
 */
export const studentsNotJoinedWindowMs = 5 * 60 * 1000;

export const studentsNotJoinedReminderType = "students_not_joined";

/**
 * Whether to tell a course channel that its class has started with an empty
 * room. `anyStudentJoined` means at least one enrolled student has been seen in
 * this class's channel at some point — someone who joined and stepped out is
 * not what this warning is for.
 */
export const shouldWarnStudentsNotJoined = ({
  nowMs,
  startsAtMs,
  anyStudentJoined,
  alreadyWarned,
}: {
  nowMs: number;
  startsAtMs: number;
  anyStudentJoined: boolean;
  alreadyWarned: boolean;
}): boolean => {
  if (anyStudentJoined || alreadyWarned) {
    return false;
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(startsAtMs)) {
    return false;
  }
  return nowMs >= startsAtMs && nowMs < startsAtMs + studentsNotJoinedWindowMs;
};
