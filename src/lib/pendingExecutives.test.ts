import { describe, expect, it } from "vitest";
import { pendingDeadlineMs, pendingWindowExpired, type PendingWindowInput } from "./pendingExecutives";

const at = (iso: string) => new Date(iso).getTime();
const pending: PendingWindowInput = {
  role: "Executive",
  teachesCourse: false,
  exempt: false,
  promotedAt: "2026-05-26T15:00:00.000Z",
  hasOpenCourseRequest: false,
};

describe("pendingDeadlineMs", () => {
  it("is six calendar months after the promotion", () => {
    expect(pendingDeadlineMs("2026-05-26T15:00:00.000Z")).toBe(at("2026-11-26T15:00:00.000Z"));
    expect(pendingDeadlineMs("2026-09-10T00:00:00.000Z")).toBe(at("2027-03-10T00:00:00.000Z"));
  });

  it("uses the month's last day when the day does not exist", () => {
    expect(pendingDeadlineMs("2026-08-31T12:00:00.000Z")).toBe(at("2027-02-28T12:00:00.000Z"));
    expect(pendingDeadlineMs("2027-08-30T12:00:00.000Z")).toBe(at("2028-02-29T12:00:00.000Z"));
  });

  it("has no deadline without a readable date", () => {
    expect(pendingDeadlineMs(null)).toBeNull();
    expect(pendingDeadlineMs("")).toBeNull();
    expect(pendingDeadlineMs("not a date")).toBeNull();
  });
});

describe("pendingWindowExpired", () => {
  it("expires a Pending executive at six months, not before", () => {
    expect(pendingWindowExpired(pending, at("2026-11-26T14:59:59.000Z"))).toBe(false);
    expect(pendingWindowExpired(pending, at("2026-11-26T15:00:00.000Z"))).toBe(true);
    expect(pendingWindowExpired(pending, at("2027-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("never touches someone who teaches, is exempt, or is waiting on management", () => {
    const later = at("2027-06-01T00:00:00.000Z");
    expect(pendingWindowExpired({ ...pending, teachesCourse: true }, later)).toBe(false);
    expect(pendingWindowExpired({ ...pending, exempt: true }, later)).toBe(false);
    expect(pendingWindowExpired({ ...pending, hasOpenCourseRequest: true }, later)).toBe(false);
  });

  it("never touches students or the ranks above Executive", () => {
    const later = at("2027-06-01T00:00:00.000Z");
    for (const role of ["student", "founder", "CEO", "COO", "CEO Shadow", "COO Shadow", "Chief Executive"] as const) {
      expect(pendingWindowExpired({ ...pending, role }, later)).toBe(false);
    }
  });

  it("leaves an account with no promotion date alone", () => {
    expect(pendingWindowExpired({ ...pending, promotedAt: null }, at("2030-01-01T00:00:00.000Z"))).toBe(false);
  });
});
