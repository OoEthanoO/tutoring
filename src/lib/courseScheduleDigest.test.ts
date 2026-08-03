import { describe, expect, it } from "vitest";
import {
  buildScheduleSnapshot,
  diffSchedules,
  formatScheduleChangeLines,
  hasSettled,
  parseScheduleSnapshot,
  scheduleQuietPeriodMs,
  schedulesMatch,
  type ScheduleSnapshot,
} from "@/lib/courseScheduleDigest";

const NOW = new Date("2026-08-01T12:00:00Z").getTime();
const future = (iso: string) => iso;
const AUG5 = "2026-08-05T23:00:00Z";
const AUG6 = "2026-08-06T23:00:00Z";
const JULY20 = "2026-07-20T23:00:00Z"; // already happened

const snapshot = (entries: Record<string, [string, number]>): ScheduleSnapshot =>
  Object.fromEntries(
    Object.entries(entries).map(([id, [startsAt, durationHours]]) => [
      id,
      { startsAt, durationHours },
    ])
  );

describe("buildScheduleSnapshot", () => {
  it("keys by class id and normalises duration", () => {
    expect(
      buildScheduleSnapshot([
        { id: "a", starts_at: AUG5, duration_hours: 1.5 },
        { id: "b", starts_at: AUG6, duration_hours: null },
      ])
    ).toEqual({
      a: { startsAt: AUG5, durationHours: 1.5 },
      b: { startsAt: AUG6, durationHours: 1 },
    });
  });

  it("ignores rows without an id", () => {
    expect(buildScheduleSnapshot([{ id: "", starts_at: AUG5 }])).toEqual({});
  });
});

describe("schedulesMatch", () => {
  it("ignores key order and equivalent timestamp spellings", () => {
    expect(
      schedulesMatch(
        snapshot({ a: [AUG5, 1], b: [AUG6, 1] }),
        snapshot({ b: [AUG6, 1], a: ["2026-08-05T23:00:00.000Z", 1] })
      )
    ).toBe(true);
  });

  it("ignores sub-minute duration noise from the numeric column", () => {
    // 70 minutes, as sent by the client and as stored.
    expect(
      schedulesMatch(snapshot({ a: [AUG5, 1.1666666666666667] }), snapshot({ a: [AUG5, 1.17] }))
    ).toBe(true);
  });

  it("detects real differences", () => {
    expect(schedulesMatch(snapshot({ a: [AUG5, 1] }), snapshot({ a: [AUG6, 1] }))).toBe(false);
    expect(schedulesMatch(snapshot({ a: [AUG5, 1] }), snapshot({ a: [AUG5, 2] }))).toBe(false);
    expect(schedulesMatch(snapshot({ a: [AUG5, 1] }), snapshot({})).valueOf()).toBe(false);
  });

  it("treats a null snapshot as matching only another null", () => {
    expect(schedulesMatch(null, null)).toBe(true);
    expect(schedulesMatch(null, snapshot({}))).toBe(false);
  });
});

describe("diffSchedules", () => {
  const titles = { a: "Class 1", b: "Class 2", c: "Class 3" };

  it("reports nothing when the schedule is unchanged", () => {
    const same = snapshot({ a: [AUG5, 1] });
    expect(diffSchedules(same, same, titles, NOW)).toEqual([]);
  });

  it("reports nothing when edits cancel out", () => {
    // The reason students are not notified per edit: moved away and back again.
    const before = snapshot({ a: [AUG5, 1] });
    const afterReverted = snapshot({ a: [future(AUG5), 1] });
    expect(diffSchedules(before, afterReverted, titles, NOW)).toEqual([]);
  });

  it("reports a move", () => {
    const changes = diffSchedules(
      snapshot({ a: [AUG5, 1] }),
      snapshot({ a: [AUG6, 1] }),
      titles,
      NOW
    );
    expect(changes).toEqual([
      { kind: "moved", classId: "a", title: "Class 1", fromStartsAt: AUG5, startsAt: AUG6 },
    ]);
  });

  it("reports a duration change in minutes", () => {
    const changes = diffSchedules(
      snapshot({ a: [AUG5, 1] }),
      snapshot({ a: [AUG5, 1.5] }),
      titles,
      NOW
    );
    expect(changes).toEqual([
      {
        kind: "duration",
        classId: "a",
        title: "Class 1",
        startsAt: AUG5,
        fromMinutes: 60,
        toMinutes: 90,
      },
    ]);
  });

  it("reports additions and cancellations", () => {
    const changes = diffSchedules(
      snapshot({ a: [AUG5, 1] }),
      snapshot({ b: [AUG6, 1] }),
      titles,
      NOW
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
  });

  it("collapses a burst of edits into the net change only", () => {
    // Three operations: move a, move it again, extend b — reported as two lines.
    const notified = snapshot({ a: [AUG5, 1], b: [AUG6, 1] });
    const current = snapshot({ a: [AUG6, 1], b: [AUG6, 2] });
    const changes = diffSchedules(notified, current, titles, NOW);
    expect(changes).toHaveLength(2);
  });

  it("ignores changes to classes that already happened", () => {
    // Correcting a past class's duration (e.g. to fix service hours) is not
    // actionable for a student.
    expect(
      diffSchedules(snapshot({ a: [JULY20, 1] }), snapshot({ a: [JULY20, 2] }), titles, NOW)
    ).toEqual([]);
    expect(diffSchedules(snapshot({ a: [JULY20, 1] }), snapshot({}), titles, NOW)).toEqual([]);
  });

  it("still reports a past class being moved into the future", () => {
    const changes = diffSchedules(
      snapshot({ a: [JULY20, 1] }),
      snapshot({ a: [AUG6, 1] }),
      titles,
      NOW
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("moved");
  });

  it("orders changes by when the class happens", () => {
    const changes = diffSchedules(
      snapshot({ a: [AUG6, 1], b: [AUG5, 1] }),
      snapshot({ a: [AUG6, 2], b: [AUG5, 2] }),
      titles,
      NOW
    );
    expect(changes.map((c) => c.classId)).toEqual(["b", "a"]);
  });
});

describe("hasSettled", () => {
  it("waits for the schedule to stop changing", () => {
    expect(hasSettled(NOW, NOW - 1000)).toBe(false);
    expect(hasSettled(NOW, NOW - scheduleQuietPeriodMs + 1)).toBe(false);
    expect(hasSettled(NOW, NOW - scheduleQuietPeriodMs)).toBe(true);
  });

  it("never settles without an observation", () => {
    expect(hasSettled(NOW, null)).toBe(false);
  });
});

describe("parseScheduleSnapshot", () => {
  it("round-trips a stored snapshot", () => {
    const built = buildScheduleSnapshot([{ id: "a", starts_at: AUG5, duration_hours: 1.5 }]);
    expect(parseScheduleSnapshot(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it("returns null when nothing has been stored yet", () => {
    expect(parseScheduleSnapshot(null)).toBeNull();
    expect(parseScheduleSnapshot(undefined)).toBeNull();
  });

  it("skips malformed entries rather than throwing", () => {
    expect(parseScheduleSnapshot({ a: "nope", b: { startsAt: AUG5 } })).toEqual({
      b: { startsAt: AUG5, durationHours: 1 },
    });
  });
});

describe("formatScheduleChangeLines", () => {
  const fmt = (value: string) => value.slice(0, 10);

  it("writes a line per change", () => {
    const lines = formatScheduleChangeLines(
      [
        { kind: "added", classId: "a", title: "Class 1", startsAt: AUG5 },
        { kind: "removed", classId: "b", title: "Class 2", startsAt: AUG6 },
        { kind: "moved", classId: "c", title: "Class 3", fromStartsAt: AUG5, startsAt: AUG6 },
        {
          kind: "duration",
          classId: "d",
          title: "Class 4",
          startsAt: AUG5,
          fromMinutes: 60,
          toMinutes: 90,
        },
      ],
      fmt
    );

    expect(lines).toEqual([
      "Class 1 was added on 2026-08-05.",
      "Class 2 on 2026-08-06 was cancelled.",
      "Class 3 moved from 2026-08-05 to 2026-08-06.",
      "Class 4 on 2026-08-05 is now 90 minutes long (was 60).",
    ]);
  });
});
