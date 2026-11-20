import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTutorAvailability } from "./withdrawalRequests";

type Row = Record<string, unknown>;

// Just enough of the query builder for getTutorAvailability: the filters it
// uses are applied to in-memory rows, and awaiting the chain yields them.
const fakeClient = (tables: Record<string, Row[]>) =>
  ({
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const query = {
        select: () => query,
        or: () => query,
        order: () => query,
        is: (column: string, value: unknown) => {
          rows = rows.filter((row) => (row[column] ?? null) === value);
          return query;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        lte: (column: string, value: string) => {
          rows = rows.filter((row) => String(row[column]) <= value);
          return query;
        },
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return query;
    },
  }) as unknown as SupabaseClient;

const past = (id: string, courseId: string, day: string, hours = 1): Row => ({
  id,
  course_id: courseId,
  starts_at: `2026-0${day}T20:00:00.000Z`,
  duration_hours: hours,
  tutor_withdrawal_id: null,
});

describe("getTutorAvailability and paid courses", () => {
  it("counts only the classes of courses that are not paid", async () => {
    const client = fakeClient({
      courses: [
        { id: "donation", grade_level: 10, is_paid: false, deleted_at: null },
        { id: "paid", grade_level: 12, is_paid: true, deleted_at: null },
      ],
      tutor_withdrawals: [],
      course_classes: [
        past("d1", "donation", "9-01"),
        past("d2", "donation", "9-08"),
        past("p1", "paid", "9-02"),
        past("p2", "paid", "9-09", 2),
        past("p3", "paid", "9-16"),
      ],
    });

    const availability = await getTutorAvailability(client, "tutor");

    expect(availability.taughtClassCount).toBe(2);
    expect(availability.availableClassHours).toEqual([1.5, 1.5]);
    expect(availability.hourSteps).toEqual([1.5, 3]);
    expect(availability.availableHours).toBe(3);
  });

  it("gives a tutor who has taught only paid courses nothing to withdraw", async () => {
    const client = fakeClient({
      courses: [{ id: "paid", grade_level: 11, is_paid: true, deleted_at: null }],
      tutor_withdrawals: [{ tutor_id: "tutor", hours: 4.5 }],
      course_classes: [past("p1", "paid", "9-02"), past("p2", "paid", "9-09")],
    });

    const availability = await getTutorAvailability(client, "tutor");

    expect(availability.availableHours).toBe(0);
    expect(availability.taughtClassCount).toBe(0);
    expect(availability.hourSteps).toEqual([]);
    // Hours withdrawn before are a matter of record and stay as they were.
    expect(availability.withdrawnHours).toBe(4.5);
  });

  it("treats a course from before paid courses existed as an ordinary course", async () => {
    const client = fakeClient({
      courses: [{ id: "older", grade_level: 11, deleted_at: null }],
      tutor_withdrawals: [],
      course_classes: [past("o1", "older", "9-02")],
    });

    const availability = await getTutorAvailability(client, "tutor");

    expect(availability.availableHours).toBe(2);
  });
});
