import { describe, expect, it } from "vitest";
import policy from "./sessionPolicy.js";

const end = Date.parse("2026-09-12T20:30:00-04:00");
const session = { classId: "science-7", phase: "live", endsAtMs: end, mustFinalize: true };

describe("Recorder channel interruption", () => {
  it("does not overwrite a recovered segment when earlier files were missing", () => {
    expect(policy.nextSegmentNumber([{ path: "class/seg-001.mp4" }, { path: "class/seg-003.mp4" }])).toBe(4);
    expect(policy.nextSegmentNumber([])).toBe(1);
  });
  it("never finalizes on a premature channel deletion", () => {
    expect(policy.canFinalizeRemovedChannel(session, end - 8 * 60000)).toBe(false);
    expect(policy.canFinalizeRemovedChannel({ ...session, phase: "after_end" }, end - 1)).toBe(false);
    expect(policy.canFinalizeRemovedChannel({ ...session, phase: "after_end" }, end + 1)).toBe(true);
  });
  it("retains the class when a tick temporarily loses it or returns another class", () => {
    expect(policy.retainSession(session, null, end - 1)).toBe(true);
    expect(policy.retainSession(session, { classId: "other" }, end - 1)).toBe(true);
    expect(policy.retainSession(session, { classId: "science-7" }, end - 1)).toBe(false);
    expect(policy.retainSession(session, null, end + 1)).toBe(false);
    expect(policy.retainSession({ ...session, test: true }, null, end - 1)).toBe(false);
  });
  it("recovers both completed segments and the interrupted current segment for upload", async () => {
    const first = { path: "seg-001.mp4", startedAtMs: end - 90 * 60000, endedAtMs: end - 30 * 60000 };
    const current = { path: "seg-002.mp4", startedAtMs: first.endedAtMs, endedAtMs: end - 8 * 60000 };
    const result = await policy.recoverSegments({ segments: [first], currentSegment: current }, async () => 4096);
    expect(result).toEqual([{ ...first, sizeBytes: 4096 }, { ...current, sizeBytes: 4096 }]);
  });
  it("keeps a first segment even if interruption occurred before any segment was completed", async () => {
    const currentSegment = { path: "seg-001.mp4", startedAtMs: end - 90 * 60000, endedAtMs: end - 89 * 60000 };
    expect(await policy.recoverSegments({ segments: [], currentSegment }, async () => 1234)).toEqual([
      { ...currentSegment, sizeBytes: 1234 },
    ]);
  });
  it("deduplicates segment paths and skips missing or empty files", async () => {
    const meta = { segments: [{ path: "good" }, { path: "empty" }, { path: "missing" }], currentSegment: { path: "good" } };
    expect(await policy.recoverSegments(meta, async (path) => {
      if (path === "missing") throw new Error("not found");
      return path === "empty" ? 0 : 1234;
    })).toEqual([{ path: "good", sizeBytes: 1234 }]);
  });
});
