import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateRecordingUpload, recordingUploadId } from "@/lib/recordingUploads";
import { markRecordingReady } from "@/lib/recordings";

const input = {
  class_id: "class-4",
  course_id: "course-1",
  tutor_id: "tutor-1",
  recording_started_at: "2026-09-09T19:00:00.000Z",
  recording_ended_at: "2026-09-09T20:02:00.000Z",
  size_bytes: 123456789,
  duration_seconds: 3720,
  upload_reason: "tutor_confirmed",
};
type Row = Record<string, unknown>;

// Small database double with primary-key uniqueness and conditional updates.
// Tests exercise the real upload/lifecycle helpers across repeated requests.
const database = (initial: Row[] = []) => {
  const rows = initial.map((row) => ({ ...row }));
  const insert = vi.fn(async (row: Row) => {
    if (rows.some((existing) => existing.id === row.id)) {
      return { error: { code: "23505", message: "duplicate key" } };
    }
    rows.push({ ...row });
    return { error: null };
  });
  const from = () => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | undefined;
    const read = () => {
      const data = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      if (patch) for (const row of data) Object.assign(row, patch);
      return { data: data.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      update: (value: Row) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      order: () => query,
      insert,
      single: async () => {
        const result = read();
        return { ...result, data: result.data[0] };
      },
      then: (resolve: (value: ReturnType<typeof read>) => unknown) => Promise.resolve(read()).then(resolve),
    };
    return query;
  };
  return { client: { from } as unknown as SupabaseClient, rows, insert };
};

describe("recording upload retries", () => {
  it("uses a stable UUID for the same capture, including crash recovery", () => {
    const id = recordingUploadId(input);
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(recordingUploadId({ ...input, size_bytes: String(input.size_bytes) })).toBe(id);
    expect(recordingUploadId({ ...input, tutor_id: "co-tutor" })).not.toBe(id);
  });

  it("returns the same row and path after a lost response or expired signed URL", async () => {
    const db = database();
    const first = await getOrCreateRecordingUpload(db.client, input);
    const retry = await getOrCreateRecordingUpload(db.client, { ...input, upload_reason: "recovered" });
    expect(retry.id).toBe(first.id);
    expect(retry.storage_path).toBe(first.storage_path);
    expect(db.rows).toHaveLength(1);
  });

  it("handles simultaneous create requests using the existing primary key", async () => {
    const db = database();
    const [first, second] = await Promise.all([
      getOrCreateRecordingUpload(db.client, input),
      getOrCreateRecordingUpload(db.client, input),
    ]);
    expect(first.id).toBe(second.id);
    expect(db.rows).toHaveLength(1);
    expect(db.insert).toHaveBeenCalledTimes(2); // Includes the losing insert.
  });

  it("reuses a legacy completed recording without altering expiry or notification state", async () => {
    const legacy = {
      ...input, id: "legacy-random-id", storage_path: "legacy.mp4", status: "ready",
      uploaded_at: "2026-09-09T20:05:00Z", expires_at: "2026-09-16T20:05:00Z",
      discord_announced_at: "2026-09-09T20:05:01Z",
    };
    const db = database([legacy]);
    expect((await getOrCreateRecordingUpload(db.client, input)).id).toBe(legacy.id);
    expect(db.rows).toEqual([legacy]);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("prefers a finished legacy upload over an unfinished duplicate", async () => {
    const db = database([
      { ...input, id: "unfinished", status: "uploading" },
      { ...input, id: "finished", status: "ready" },
    ]);
    expect((await getOrCreateRecordingUpload(db.client, input)).id).toBe("finished");
  });

  it("keeps a separate capture even if its class and displayed duration match", async () => {
    const db = database();
    await getOrCreateRecordingUpload(db.client, input);
    await getOrCreateRecordingUpload(db.client, { ...input, recording_started_at: "2026-09-09T19:00:01.000Z" });
    expect(db.rows).toHaveLength(2);
  });

  it("does not reset the seven-day expiry on competing completion calls", async () => {
    const db = database();
    const row = await getOrCreateRecordingUpload(db.client, input);
    const completedAt = Date.parse("2026-09-09T20:05:00Z");
    await markRecordingReady(db.client, row.id, { nowMs: completedAt, sizeBytes: input.size_bytes, durationSeconds: 3720 });
    const completed = { ...db.rows[0] };
    await markRecordingReady(db.client, row.id, { nowMs: completedAt + 60000, sizeBytes: input.size_bytes, durationSeconds: 3720 });
    expect(db.rows[0]).toEqual(completed);
    expect(db.rows[0].status).toBe("ready");
    expect(db.rows[0].expires_at).toBe("2026-09-16T20:05:00.000Z");
  });
});
