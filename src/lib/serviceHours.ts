/**
 * Community service hours earned by tutors.
 *
 * Hours are earned per hour SPENT TEACHING, not per class: a class is worth its
 * scheduled duration multiplied by the course's rate — 1.5 normally, 2 for
 * courses taught at grade 11 or 12 (decided July 2026). The grade level lives on
 * `courses.grade_level` and is set by the founder/CEO/COO; courses without one
 * earn the base rate.
 *
 * Counting time rather than classes is what makes the schedule irrelevant
 * (August 2026). When a tutor misses a class, the policy is to delete it and
 * extend a later one; under per-class counting that silently destroyed the hours
 * for the deleted class even though the same teaching time was delivered. Under
 * per-hour counting the extended class absorbs the difference automatically.
 *
 * A standard 60-minute class still yields exactly 1.5 (or 2) hours, so the
 * change is invisible for courses whose classes are all an hour long.
 *
 * Withdrawals still consume the oldest available classes, so a valid withdrawal
 * amount is one of the running totals in `withdrawableHourSteps`.
 */

export const BASE_HOURS_PER_TEACHING_HOUR = 1.5;
export const SENIOR_HOURS_PER_TEACHING_HOUR = 2;
export const SENIOR_GRADE_LEVELS: number[] = [11, 12];

export const MIN_GRADE_LEVEL = 1;
export const MAX_GRADE_LEVEL = 12;

// Round so accumulated sums never surface as 4.499999999999999 in an error
// message or on a certificate.
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Coerce a grade level from a DB column, form field, or JSON body. */
export const normalizeGradeLevel = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < MIN_GRADE_LEVEL || parsed > MAX_GRADE_LEVEL) {
    return null;
  }
  return parsed;
};

/** Service hours earned per hour spent teaching a course at this grade level. */
export const serviceHourMultiplierForGrade = (gradeLevel: unknown): number => {
  const grade = normalizeGradeLevel(gradeLevel);
  return grade !== null && SENIOR_GRADE_LEVELS.includes(grade)
    ? SENIOR_HOURS_PER_TEACHING_HOUR
    : BASE_HOURS_PER_TEACHING_HOUR;
};

/**
 * Teaching time of one class, from the `duration_hours` column. Anything missing
 * or unusable counts as one hour, matching how the rest of the codebase reads
 * that column (see impactStats.parseHours) — a class is never worth zero because
 * its duration failed to parse.
 */
export const parseTeachingHours = (value: unknown): number => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * Service hours a single class is worth: its teaching time times the course's
 * rate. A 60-minute class at the base rate is 1.5 hours, a 90-minute one 2.25.
 */
export const serviceHoursForClass = (
  durationHours: unknown,
  gradeLevel: unknown
): number =>
  round2(parseTeachingHours(durationHours) * serviceHourMultiplierForGrade(gradeLevel));

/**
 * Total service hours for a set of classes — the whole-course figure. Because
 * this sums teaching time, deleting a class and extending another by the same
 * amount leaves the total unchanged.
 */
export const serviceHoursForClasses = (
  classes: { durationHours: unknown }[],
  gradeLevel: unknown
): number =>
  round2(
    classes.reduce(
      (total, item) => total + serviceHoursForClass(item.durationHours, gradeLevel),
      0
    )
  );

export const sumHours = (values: number[]): number =>
  round2(values.reduce((total, value) => total + value, 0));

/**
 * Running totals for withdrawing the oldest 1, 2, ... n classes. The last entry
 * is the tutor's full available balance, and every entry is a valid withdrawal
 * amount.
 */
export const withdrawableHourSteps = (perClassHours: number[]): number[] => {
  const steps: number[] = [];
  let total = 0;
  for (const hours of perClassHours) {
    total = round2(total + hours);
    steps.push(total);
  }
  return steps;
};

/**
 * How many of the oldest classes add up to exactly `hours`, or null when no
 * prefix does (e.g. asking for 1.5 hours when the oldest class is worth 2).
 */
export const classCountForHours = (
  perClassHours: number[],
  hours: number
): number | null => {
  const steps = withdrawableHourSteps(perClassHours);
  const index = steps.findIndex((step) => Math.abs(step - hours) < 1e-9);
  return index === -1 ? null : index + 1;
};

/** Human-readable list of valid withdrawal amounts, for error messages. */
export const describeHourSteps = (perClassHours: number[], limit = 8): string => {
  const steps = withdrawableHourSteps(perClassHours);
  if (steps.length === 0) {
    return "none";
  }
  const shown = steps.slice(0, limit).join(", ");
  return steps.length > limit ? `${shown}, ...` : shown;
};
