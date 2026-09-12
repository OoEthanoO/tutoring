import { describe, expect, it } from "vitest";
import { recordingFingerprint, uniqueRecordings } from "@/lib/recordingIdentity";

const original = {
  id: "original",
  class_id: "class-4",
  tutor_id: "tutor-1",
  recording_started_at: "2026-09-09T19:00:00.123Z",
  recording_ended_at: "2026-09-09T20:02:00.456Z",
  size_bytes: 123456789,
  duration_seconds: 3720,
  uploaded_at: "2026-09-09T20:05:00Z",
};

describe("recording identity", () => {
  it("matches Postgres timezone/numeric representations of the same capture", () => {
    expect(recordingFingerprint({
      ...original,
      size_bytes: "123456789",
      recording_started_at: "2026-09-09T15:00:00.123-04:00",
      recording_ended_at: "2026-09-09T20:02:00.456000+00:00",
    })).toBe(recordingFingerprint(original));
  });

  it("shows the original once even when duplicate uploads arrive later", () => {
    const repeated = { ...original, id: "retry", uploaded_at: "2026-09-09T21:00:00Z" };
    const nextClass = { ...original, id: "class-5-recording", class_id: "class-5" };
    expect(uniqueRecordings([nextClass, repeated, original])).toEqual([nextClass, original]);
    expect(uniqueRecordings([original, repeated])).toEqual([original]);
  });

  it.each([
    { class_id: "class-5" },
    { tutor_id: "co-tutor" },
    { recording_started_at: "2026-09-09T19:30:00Z" },
    { recording_ended_at: "2026-09-09T20:03:00Z" },
    { size_bytes: 123456788 },
    { duration_seconds: 3710 },
  ])("preserves a distinct recording with %j", (difference) => {
    const distinct = { ...original, ...difference, id: "other" };
    expect(uniqueRecordings([original, distinct])).toEqual([original, distinct]);
  });

  it.each([
    { recording_started_at: null },
    { recording_ended_at: "invalid" },
    { recording_ended_at: "2026-09-08T20:02:00Z" },
    { size_bytes: null },
    { duration_seconds: null },
  ])("does not guess a duplicate when metadata is incomplete: %j", (difference) => {
    const incomplete = { ...original, ...difference };
    expect(recordingFingerprint(incomplete)).toBeNull();
    expect(uniqueRecordings([incomplete, { ...incomplete, id: "other" }])).toHaveLength(2);
  });
});
