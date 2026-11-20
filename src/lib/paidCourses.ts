/**
 * Paid courses (November 2026). See PAID_COURSES.md.
 *
 * Most courses ask families for a donation to SickKids through the tutor's
 * fundraiser link. A paid course has a fee that the family pays straight to
 * the tutor instead. YanLearn never receives or holds that money: the site
 * shows the tutor's payment note, the tutor marks each payment as received,
 * and only then can management approve the enrollment.
 *
 * The rules, all enforced on the server through the functions below:
 * - Only senior tutors (a tick the founder, CEO or COO sets on an account)
 *   may teach a paid course. A co-tutor has to be senior as well.
 * - The course's tutor needs a payment note before the course can be paid.
 * - An enrollment in a paid course cannot be approved until the tutor has
 *   confirmed the payment.
 * - A paid course earns no community service hours.
 *
 * Everything here is pure, so it is shared by the routes and the interface.
 */

import { classEndMs } from "@/lib/classTiming";

export const MIN_PAID_FEE = 1;
export const MAX_PAID_FEE = 5000;
export const MAX_PAYMENT_NOTE_LENGTH = 300;
const MAX_PAYMENT_NOTE_LINES = 6;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A usable paid-course fee in dollars, or null when the value is not one. */
export const normalizePaidFee = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < MIN_PAID_FEE || parsed > MAX_PAID_FEE) {
    return null;
  }
  return round2(parsed);
};

/** "$50" or "$49.50": whole dollars lose the cents. */
export const formatPaidFee = (fee: unknown): string => {
  const parsed = typeof fee === "number" ? fee : Number(fee);
  if (!Number.isFinite(parsed)) {
    return "$0";
  }
  return Number.isInteger(parsed) ? `$${parsed}` : `$${parsed.toFixed(2)}`;
};

export type PaymentNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; error: string };

/**
 * A tutor's payment note as it is stored: plain text, trimmed, a few short
 * lines at most. An empty note is stored as null.
 */
export const normalizePaymentNote = (value: unknown): PaymentNoteResult => {
  if (value === null || value === undefined) {
    return { ok: true, note: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "The payment note has to be text." };
  }
  const lines = Array.from(value.replace(/\r\n?/g, "\n").replace(/\t/g, " "))
    // Control characters (other than the line breaks above) are never typed on purpose.
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line);
  if (lines.length === 0) {
    return { ok: true, note: null };
  }
  if (lines.length > MAX_PAYMENT_NOTE_LINES) {
    return { ok: false, error: `Keep the payment note to ${MAX_PAYMENT_NOTE_LINES} lines or fewer.` };
  }
  const note = lines.join("\n");
  if (note.length > MAX_PAYMENT_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Keep the payment note to ${MAX_PAYMENT_NOTE_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, note };
};

export type PaidCourseTutor = {
  seniorTutor: boolean;
  paymentNote?: string | null;
};

/**
 * Why this course cannot be a paid course, or null when it can. `owner` is the
 * tutor the families pay; `coTutor` is passed only for a co-taught course.
 */
export const paidCourseBlocker = (input: {
  owner: PaidCourseTutor | null;
  coTutor?: PaidCourseTutor | null;
  fee: unknown;
}): string | null => {
  if (!input.owner) {
    return "A paid course needs a tutor: families pay the tutor directly.";
  }
  if (!input.owner.seniorTutor) {
    return "Only senior tutors can teach paid courses. This course's tutor is not a senior tutor.";
  }
  if (input.coTutor && !input.coTutor.seniorTutor) {
    return "Only senior tutors can teach paid courses. This course's co-tutor is not a senior tutor.";
  }
  if (!String(input.owner.paymentNote ?? "").trim()) {
    return "The tutor has not added a payment note yet. Families need it to pay, so it has to be in place before the course becomes a paid course.";
  }
  if (normalizePaidFee(input.fee) === null) {
    return `A paid course needs a fee between $${MIN_PAID_FEE} and $${MAX_PAID_FEE}.`;
  }
  return null;
};

/**
 * Why a course cannot switch between paid and donation, or null when it can.
 * Once families have paid or donated, or a class has been taught, the switch
 * would change what they agreed to and what the taught classes are worth in
 * service hours.
 */
export const paidStatusChangeBlocker = (input: {
  hasStartedClass: boolean;
  enrollmentCount: number;
  pendingRequestCount: number;
}): string | null => {
  if (input.hasStartedClass) {
    return "This course has already had a class, so it can no longer switch between paid and donation.";
  }
  if (input.enrollmentCount > 0) {
    return "This course already has enrolled students, so it can no longer switch between paid and donation.";
  }
  if (input.pendingRequestCount > 0) {
    return "This course has enrollment requests waiting, so it cannot switch between paid and donation until they are decided.";
  }
  return null;
};

/**
 * Whether a course is still running: no classes scheduled yet, or at least one
 * class that has not ended. Finished and deleted courses do not hold a tutor
 * to the paid-course rules any more.
 */
export const courseIsActive = (
  course: {
    deleted_at?: string | null;
    is_completed?: boolean | null;
    course_classes?: { starts_at: string; duration_hours?: unknown }[] | null;
  },
  nowMs: number
): boolean => {
  if (course.deleted_at || course.is_completed) {
    return false;
  }
  const classes = course.course_classes ?? [];
  if (classes.length === 0) {
    return true;
  }
  return classes.some((item) => {
    const start = new Date(item.starts_at).getTime();
    if (!Number.isFinite(start)) {
      return false;
    }
    return classEndMs(start, item.duration_hours) > nowMs;
  });
};

/** Why the "Senior tutor" tick cannot be removed, or null when it can. */
export const seniorUntickBlocker = (activePaidCourseCount: number): string | null =>
  activePaidCourseCount > 0
    ? `This tutor teaches ${activePaidCourseCount} paid ${activePaidCourseCount === 1 ? "course" : "courses"} that ${activePaidCourseCount === 1 ? "is" : "are"} still running. Only senior tutors can teach paid courses, so finish or reassign ${activePaidCourseCount === 1 ? "it" : "them"} first.`
    : null;

/** Why a payment note cannot be removed, or null when it can. */
export const paymentNoteClearBlocker = (activePaidCourseCount: number): string | null =>
  activePaidCourseCount > 0
    ? "Families need the payment note to pay for a paid course that is still running, so it can be changed but not removed."
    : null;

/**
 * Why this person cannot mark a payment as received (or undo that), or null
 * when they can. Only the course's own tutor can: the money goes to their
 * account, so nobody else knows whether it arrived.
 */
export const paymentConfirmationBlocker = (input: {
  courseIsPaid: boolean;
  courseOwnerId: string | null | undefined;
  actorId: string;
  requestStatus: string;
}): string | null => {
  if (!input.courseIsPaid) {
    return "This is not a paid course, so there is no payment to confirm.";
  }
  if (!input.courseOwnerId || input.courseOwnerId !== input.actorId) {
    return "Only the course's own tutor can confirm a payment, because the payment goes to their account.";
  }
  if (input.requestStatus !== "pending") {
    return "This enrollment request has already been decided.";
  }
  return null;
};

/**
 * Why an enrollment request cannot be approved yet, or null when it can. A
 * course that is not paid is never held up by this.
 */
export const enrollmentApprovalBlocker = (input: {
  courseIsPaid: boolean;
  paymentConfirmedAt: string | null | undefined;
}): string | null =>
  input.courseIsPaid && !input.paymentConfirmedAt
    ? "This is a paid course. The tutor has to mark the payment as received before the enrollment can be approved."
    : null;

/** Paid teaching is not volunteer work: a paid course earns no service hours. */
export const courseEarnsServiceHours = (course: { is_paid?: boolean | null }): boolean =>
  !course.is_paid;
