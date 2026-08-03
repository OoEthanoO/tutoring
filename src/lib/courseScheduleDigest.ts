/**
 * Student-facing digests of course schedule changes.
 *
 * Executives get a message for every individual edit, which is right for them —
 * they are the ones making the edits and want to see each one land. Students
 * need the opposite: rescheduling a course often takes several operations, some
 * of which are mistakes that get reverted moments later, and a message per
 * operation is noise at best and misleading at worst.
 *
 * So rather than reacting to edit events, this compares the course's CURRENT
 * schedule against the last one students were told about. That has three useful
 * consequences:
 *
 *  - Edits that cancel out produce no message at all, because the net diff
 *    against the last notified state is empty.
 *  - A burst of edits collapses into one digest listing only what actually
 *    changed, once the schedule stops moving (see `hasSettled`).
 *  - It needs no hooks in the many endpoints that can mutate classes; anything
 *    that changes the schedule is picked up, including bulk operations.
 *
 * Only the schedule is considered. Renaming a course or a class, changing its
 * description, and so on never reach students through this path.
 */

export type ScheduleEntry = {
  startsAt: string;
  durationHours: number;
};

/** A course's schedule, keyed by class id so that relabelling is not a change. */
export type ScheduleSnapshot = Record<string, ScheduleEntry>;

export type ScheduleChange =
  | { kind: "added"; classId: string; title: string; startsAt: string }
  | { kind: "removed"; classId: string; title: string; startsAt: string }
  | {
    kind: "moved";
    classId: string;
    title: string;
    fromStartsAt: string;
    startsAt: string;
  }
  | {
    kind: "duration";
    classId: string;
    title: string;
    startsAt: string;
    fromMinutes: number;
    toMinutes: number;
  };

const parseDurationHours = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const toMinutes = (durationHours: number) => Math.round(durationHours * 60);

const sameInstant = (left: string, right: string) => {
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return left === right;
  }
  return leftMs === rightMs;
};

export const buildScheduleSnapshot = (
  classes: { id: string; starts_at: string; duration_hours?: number | string | null }[]
): ScheduleSnapshot => {
  const snapshot: ScheduleSnapshot = {};
  for (const item of classes) {
    const id = String(item.id ?? "").trim();
    if (!id) {
      continue;
    }
    snapshot[id] = {
      startsAt: String(item.starts_at),
      durationHours: parseDurationHours(item.duration_hours),
    };
  }
  return snapshot;
};

/** Whether two snapshots describe the same schedule (order-independent). */
export const schedulesMatch = (
  left: ScheduleSnapshot | null,
  right: ScheduleSnapshot | null
): boolean => {
  if (!left || !right) {
    return left === right;
  }
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  if (leftIds.length !== rightIds.length) {
    return false;
  }
  return leftIds.every((id, index) => {
    if (rightIds[index] !== id) {
      return false;
    }
    return (
      sameInstant(left[id].startsAt, right[id].startsAt) &&
      toMinutes(left[id].durationHours) === toMinutes(right[id].durationHours)
    );
  });
};

export const parseScheduleSnapshot = (value: unknown): ScheduleSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const snapshot: ScheduleSnapshot = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as { startsAt?: unknown; durationHours?: unknown };
    if (typeof record.startsAt !== "string") {
      continue;
    }
    snapshot[id] = {
      startsAt: record.startsAt,
      durationHours: parseDurationHours(record.durationHours),
    };
  }
  return snapshot;
};

/**
 * What changed between the schedule students were last told about and the
 * current one.
 *
 * Changes that only concern classes already in the past are dropped: correcting
 * last week's duration (to fix service hours, say) is not something a student
 * can act on, and telling them is pure noise. A class counts as relevant if
 * either its old or its new start time is still ahead.
 */
export const diffSchedules = (
  previous: ScheduleSnapshot,
  current: ScheduleSnapshot,
  titles: Record<string, string>,
  nowMs: number
): ScheduleChange[] => {
  const changes: ScheduleChange[] = [];
  const isUpcoming = (value: string) => {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? true : ms > nowMs;
  };
  const titleFor = (classId: string) => titles[classId] ?? "A class";

  for (const [classId, entry] of Object.entries(current)) {
    const before = previous[classId];
    if (!before) {
      if (isUpcoming(entry.startsAt)) {
        changes.push({
          kind: "added",
          classId,
          title: titleFor(classId),
          startsAt: entry.startsAt,
        });
      }
      continue;
    }

    if (!sameInstant(before.startsAt, entry.startsAt)) {
      if (isUpcoming(before.startsAt) || isUpcoming(entry.startsAt)) {
        changes.push({
          kind: "moved",
          classId,
          title: titleFor(classId),
          fromStartsAt: before.startsAt,
          startsAt: entry.startsAt,
        });
      }
      continue;
    }

    const fromMinutes = toMinutes(before.durationHours);
    const nextMinutes = toMinutes(entry.durationHours);
    if (fromMinutes !== nextMinutes && isUpcoming(entry.startsAt)) {
      changes.push({
        kind: "duration",
        classId,
        title: titleFor(classId),
        startsAt: entry.startsAt,
        fromMinutes,
        toMinutes: nextMinutes,
      });
    }
  }

  for (const [classId, entry] of Object.entries(previous)) {
    if (current[classId]) {
      continue;
    }
    if (isUpcoming(entry.startsAt)) {
      changes.push({
        kind: "removed",
        classId,
        title: titleFor(classId),
        startsAt: entry.startsAt,
      });
    }
  }

  return changes.sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
};

/** How long the schedule must stop changing before students are told. */
export const scheduleQuietPeriodMs = 20 * 60 * 1000;

/**
 * Whether the schedule has been stable long enough to notify. Every edit pushes
 * `observedAtMs` forward, so a run of corrections only reports once the person
 * doing them has finished.
 */
export const hasSettled = (nowMs: number, observedAtMs: number | null): boolean =>
  observedAtMs === null ? false : nowMs - observedAtMs >= scheduleQuietPeriodMs;

/** One human-readable line per change, given a date formatter. */
export const formatScheduleChangeLines = (
  changes: ScheduleChange[],
  formatDateTime: (value: string) => string
): string[] =>
  changes.map((change) => {
    switch (change.kind) {
      case "added":
        return `${change.title} was added on ${formatDateTime(change.startsAt)}.`;
      case "removed":
        return `${change.title} on ${formatDateTime(change.startsAt)} was cancelled.`;
      case "moved":
        return `${change.title} moved from ${formatDateTime(change.fromStartsAt)} to ${formatDateTime(change.startsAt)}.`;
      case "duration":
        return `${change.title} on ${formatDateTime(change.startsAt)} is now ${change.toMinutes} minutes long (was ${change.fromMinutes}).`;
    }
  });
