/**
 * Suggesting the next class date/time when a tutor adds a class.
 *
 * The interval between classes is measured in local calendar days plus
 * wall-clock minutes, never in raw milliseconds. A weekly 8:00 PM class spans
 * 167 or 169 hours across a daylight-saving change, so adding the raw
 * millisecond gap to the last class shifts the suggestion to 7:00 PM or
 * 9:00 PM. Tutors schedule by wall clock, so the suggestion keeps the wall
 * clock and lets the offset move.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Local calendar day as a day number, independent of the UTC offset. */
const localDayNumber = (value: Date) =>
  Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY;

const minutesIntoLocalDay = (value: Date) =>
  value.getHours() * 60 + value.getMinutes();

/**
 * `start` moved forward by whole local days and then by wall-clock minutes.
 * Both steps go through the local-time setters, so the time of day survives a
 * daylight-saving boundary.
 */
export const addLocalDaysAndMinutes = (
  start: Date,
  days: number,
  minutes: number
): Date => {
  const result = new Date(start.getTime());
  result.setDate(result.getDate() + days);
  if (minutes !== 0) {
    result.setMinutes(result.getMinutes() + minutes);
  }
  return result;
};

/**
 * The start time to pre-fill for the next class of a course: one interval
 * after the latest existing class, where the interval is the local-time gap
 * between the two latest classes (a week when there is only one class).
 * Returns null when there is nothing to extrapolate from.
 */
export const suggestNextClassStart = (
  existingStarts: Array<string | number | Date>
): Date | null => {
  const starts = existingStarts
    .map((value) => (value instanceof Date ? new Date(value.getTime()) : new Date(value)))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (starts.length === 0) {
    return null;
  }

  const latest = starts[starts.length - 1];

  if (starts.length === 1) {
    return addLocalDaysAndMinutes(latest, 7, 0);
  }

  const previous = starts[starts.length - 2];
  const dayGap = localDayNumber(latest) - localDayNumber(previous);
  const minuteGap = minutesIntoLocalDay(latest) - minutesIntoLocalDay(previous);

  return addLocalDaysAndMinutes(latest, dayGap, minuteGap);
};
