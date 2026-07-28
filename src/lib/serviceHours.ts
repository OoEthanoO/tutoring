/**
 * Community service hours earned by tutors, per class taught.
 *
 * A class is normally worth 1.5 hours, but courses taught at grade 11 or 12 are
 * worth 2 hours (decided July 2026). The grade level lives on `courses.grade_level`
 * and is set by the founder/CEO/COO; courses without one earn the base rate.
 *
 * Because the rate is no longer uniform, a withdrawal of N hours is not simply
 * N / 1.5 classes: withdrawals always consume the oldest available classes, so a
 * valid withdrawal amount is one of the running totals in `withdrawableHourSteps`.
 */

export const BASE_HOURS_PER_CLASS = 1.5;
export const SENIOR_HOURS_PER_CLASS = 2;
export const SENIOR_GRADE_LEVELS: number[] = [11, 12];

export const MIN_GRADE_LEVEL = 1;
export const MAX_GRADE_LEVEL = 12;

// Hours are multiples of 0.5, but round anyway so accumulated sums never surface
// as 4.499999999999999 in an error message or a certificate.
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

/** Service hours a tutor earns for one class of a course at this grade level. */
export const hoursPerClassForGrade = (gradeLevel: unknown): number => {
  const grade = normalizeGradeLevel(gradeLevel);
  return grade !== null && SENIOR_GRADE_LEVELS.includes(grade)
    ? SENIOR_HOURS_PER_CLASS
    : BASE_HOURS_PER_CLASS;
};

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
