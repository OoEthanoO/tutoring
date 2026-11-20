import { describe, expect, it } from "vitest";
import {
  MAX_PAID_FEE,
  MAX_PAYMENT_NOTE_LENGTH,
  courseEarnsServiceHours,
  courseIsActive,
  enrollmentApprovalBlocker,
  formatPaidFee,
  normalizePaidFee,
  normalizePaymentNote,
  paidCourseBlocker,
  paidStatusChangeBlocker,
  paymentConfirmationBlocker,
  paymentNoteClearBlocker,
  seniorUntickBlocker,
} from "./paidCourses";

const senior = { seniorTutor: true, paymentNote: "e-Transfer to the address on file" };

describe("normalizePaidFee", () => {
  it("accepts dollars and cents from numbers and form text", () => {
    expect(normalizePaidFee(50)).toBe(50);
    expect(normalizePaidFee(" 49.5 ")).toBe(49.5);
    expect(normalizePaidFee(19.999)).toBe(20);
    expect(normalizePaidFee(MAX_PAID_FEE)).toBe(MAX_PAID_FEE);
  });

  it("rejects an empty, zero, negative, oversized or non-numeric fee", () => {
    for (const value of [null, undefined, "", 0, -5, 0.5, MAX_PAID_FEE + 1, "fifty", Number.NaN, Infinity]) {
      expect(normalizePaidFee(value)).toBeNull();
    }
  });
});

describe("formatPaidFee", () => {
  it("drops the cents from whole dollars only", () => {
    expect(formatPaidFee(50)).toBe("$50");
    expect(formatPaidFee("50.00")).toBe("$50");
    expect(formatPaidFee(49.5)).toBe("$49.50");
    expect(formatPaidFee(null)).toBe("$0");
    expect(formatPaidFee("abc")).toBe("$0");
  });
});

describe("normalizePaymentNote", () => {
  it("stores an empty note as null", () => {
    expect(normalizePaymentNote(null)).toEqual({ ok: true, note: null });
    expect(normalizePaymentNote("  \n\t ")).toEqual({ ok: true, note: null });
  });

  it("trims, collapses spacing and drops blank lines and control characters", () => {
    expect(normalizePaymentNote("  Interac   e-Transfer\r\n\r\n to the\taddress below\u0007 ")).toEqual({
      ok: true,
      note: "Interac e-Transfer\nto the address below",
    });
  });

  it("refuses anything but text, and notes that are too long", () => {
    expect(normalizePaymentNote(42).ok).toBe(false);
    expect(normalizePaymentNote("x".repeat(MAX_PAYMENT_NOTE_LENGTH)).ok).toBe(true);
    expect(normalizePaymentNote("x".repeat(MAX_PAYMENT_NOTE_LENGTH + 1)).ok).toBe(false);
    expect(normalizePaymentNote("a\nb\nc\nd\ne\nf\ng").ok).toBe(false);
  });
});

describe("paidCourseBlocker", () => {
  it("allows a senior tutor with a payment note and a fee", () => {
    expect(paidCourseBlocker({ owner: senior, fee: 60 })).toBeNull();
    expect(paidCourseBlocker({ owner: senior, coTutor: { seniorTutor: true }, fee: 60 })).toBeNull();
  });

  it("refuses a course with no tutor", () => {
    expect(paidCourseBlocker({ owner: null, fee: 60 })).toContain("needs a tutor");
  });

  it("refuses a tutor who is not senior", () => {
    expect(paidCourseBlocker({ owner: { ...senior, seniorTutor: false }, fee: 60 })).toContain(
      "Only senior tutors"
    );
  });

  it("refuses a co-tutor who is not senior", () => {
    expect(
      paidCourseBlocker({ owner: senior, coTutor: { seniorTutor: false }, fee: 60 })
    ).toContain("co-tutor");
  });

  it("refuses a tutor without a payment note", () => {
    expect(paidCourseBlocker({ owner: { seniorTutor: true, paymentNote: "  " }, fee: 60 })).toContain(
      "payment note"
    );
    expect(paidCourseBlocker({ owner: { seniorTutor: true }, fee: 60 })).toContain("payment note");
  });

  it("refuses a missing or unusable fee", () => {
    expect(paidCourseBlocker({ owner: senior, fee: null })).toContain("needs a fee");
    expect(paidCourseBlocker({ owner: senior, fee: 0 })).toContain("needs a fee");
  });
});

describe("paidStatusChangeBlocker", () => {
  const untouched = { hasStartedClass: false, enrollmentCount: 0, pendingRequestCount: 0 };

  it("allows the switch before anyone has enrolled or been taught", () => {
    expect(paidStatusChangeBlocker(untouched)).toBeNull();
  });

  it("refuses once a class has started, a student is enrolled or a request waits", () => {
    expect(paidStatusChangeBlocker({ ...untouched, hasStartedClass: true })).toContain("already had a class");
    expect(paidStatusChangeBlocker({ ...untouched, enrollmentCount: 1 })).toContain("enrolled students");
    expect(paidStatusChangeBlocker({ ...untouched, pendingRequestCount: 2 })).toContain("requests waiting");
  });
});

describe("courseIsActive", () => {
  const now = Date.parse("2026-11-20T18:00:00.000Z");
  const lesson = (startsAt: string, hours: unknown = 1) => ({ starts_at: startsAt, duration_hours: hours });

  it("counts a course with no classes yet as running", () => {
    expect(courseIsActive({ course_classes: [] }, now)).toBe(true);
    expect(courseIsActive({}, now)).toBe(true);
  });

  it("counts a course as running until its last class has ended", () => {
    expect(courseIsActive({ course_classes: [lesson("2026-11-20T17:30:00.000Z")] }, now)).toBe(true);
    expect(courseIsActive({ course_classes: [lesson("2026-11-20T16:00:00.000Z", 1.5)] }, now)).toBe(false);
    expect(
      courseIsActive(
        { course_classes: [lesson("2026-11-01T16:00:00.000Z"), lesson("2026-12-01T16:00:00.000Z")] },
        now
      )
    ).toBe(true);
  });

  it("never counts a deleted or completed course", () => {
    const upcoming = [lesson("2026-12-01T16:00:00.000Z")];
    expect(courseIsActive({ deleted_at: "2026-11-01T00:00:00.000Z", course_classes: upcoming }, now)).toBe(false);
    expect(courseIsActive({ is_completed: true, course_classes: upcoming }, now)).toBe(false);
  });

  it("treats an unusable duration as one hour and ignores unusable dates", () => {
    expect(courseIsActive({ course_classes: [lesson("2026-11-20T17:30:00.000Z", null)] }, now)).toBe(true);
    expect(courseIsActive({ course_classes: [lesson("not a date")] }, now)).toBe(false);
  });
});

describe("holding a tutor to a running paid course", () => {
  it("keeps the senior tick while a paid course is running", () => {
    expect(seniorUntickBlocker(0)).toBeNull();
    expect(seniorUntickBlocker(1)).toContain("1 paid course that is still running");
    expect(seniorUntickBlocker(2)).toContain("2 paid courses that are still running");
  });

  it("keeps a payment note in place while a paid course is running", () => {
    expect(paymentNoteClearBlocker(0)).toBeNull();
    expect(paymentNoteClearBlocker(1)).toContain("not removed");
  });
});

describe("paymentConfirmationBlocker", () => {
  const base = { courseIsPaid: true, courseOwnerId: "tutor", actorId: "tutor", requestStatus: "pending" };

  it("lets the course's own tutor confirm a pending request", () => {
    expect(paymentConfirmationBlocker(base)).toBeNull();
  });

  it("refuses anyone else, management and co-tutors included", () => {
    expect(paymentConfirmationBlocker({ ...base, actorId: "someone-else" })).toContain("own tutor");
    expect(paymentConfirmationBlocker({ ...base, courseOwnerId: null })).toContain("own tutor");
  });

  it("refuses on a course that is not paid and on a decided request", () => {
    expect(paymentConfirmationBlocker({ ...base, courseIsPaid: false })).toContain("not a paid course");
    expect(paymentConfirmationBlocker({ ...base, requestStatus: "approved" })).toContain("already been decided");
    expect(paymentConfirmationBlocker({ ...base, requestStatus: "rejected" })).toContain("already been decided");
  });
});

describe("enrollmentApprovalBlocker", () => {
  it("never holds up a course that is not paid", () => {
    expect(enrollmentApprovalBlocker({ courseIsPaid: false, paymentConfirmedAt: null })).toBeNull();
  });

  it("holds a paid course until the tutor has confirmed the payment", () => {
    expect(enrollmentApprovalBlocker({ courseIsPaid: true, paymentConfirmedAt: null })).toContain(
      "mark the payment as received"
    );
    expect(enrollmentApprovalBlocker({ courseIsPaid: true, paymentConfirmedAt: undefined })).not.toBeNull();
    expect(
      enrollmentApprovalBlocker({ courseIsPaid: true, paymentConfirmedAt: "2026-11-20T18:00:00.000Z" })
    ).toBeNull();
  });
});

describe("courseEarnsServiceHours", () => {
  it("is false only for a paid course", () => {
    expect(courseEarnsServiceHours({ is_paid: true })).toBe(false);
    expect(courseEarnsServiceHours({ is_paid: false })).toBe(true);
    expect(courseEarnsServiceHours({ is_paid: null })).toBe(true);
    expect(courseEarnsServiceHours({})).toBe(true);
  });
});
