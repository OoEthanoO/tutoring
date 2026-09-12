import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordingFingerprint, type RecordingIdentity } from "@/lib/recordingIdentity";
import { buildRecordingStoragePath, recordingsBucket } from "@/lib/recordings";

type UploadInput = RecordingIdentity & { course_id: string; upload_reason: string | null };
type UploadRow = RecordingIdentity & {
  id: string;
  status: string;
  storage_path: string;
  expires_at: string | null;
};
const uploadColumns = "id, status, storage_path, expires_at, class_id, tutor_id, recording_started_at, recording_ended_at, size_bytes, duration_seconds";

/** A UUID derived from the capture makes concurrent/replayed requests share the PK. */
export const recordingUploadId = (recording: RecordingIdentity): string => {
  const fingerprint = recordingFingerprint(recording);
  if (!fingerprint) return crypto.randomUUID();
  const bytes = crypto.createHash("sha256").update(`yanlearn-recording:v1:${fingerprint}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // UUIDv8: application-defined identity.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const getOrCreateRecordingUpload = async (
  adminClient: SupabaseClient,
  input: UploadInput
): Promise<UploadRow> => {
  const fingerprint = recordingFingerprint(input);
  if (fingerprint) {
    // Find recordings created before stable IDs were introduced, including
    // finished uploads recovered from a leftover pending.json on the tutor's PC.
    const { data, error } = await adminClient.from("class_recordings")
      .select(uploadColumns)
      .eq("class_id", input.class_id)
      .eq("tutor_id", input.tutor_id)
      .eq("recording_started_at", input.recording_started_at!)
      .eq("recording_ended_at", input.recording_ended_at!)
      .order("uploaded_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const matches = ((data ?? []) as UploadRow[]).filter((row) => recordingFingerprint(row) === fingerprint);
    const existing = matches.find((row) => row.status === "ready") ?? matches[0];
    if (existing) return existing;
  }

  const id = recordingUploadId(input);
  const row = {
    ...input,
    id,
    status: "uploading",
    storage_bucket: recordingsBucket,
    storage_path: buildRecordingStoragePath(input.course_id, input.class_id, id),
    content_type: "video/mp4",
  };
  const { error } = await adminClient.from("class_recordings").insert(row);
  if (!error) return { ...row, expires_at: null };
  if (error.code !== "23505") throw new Error(error.message);

  // Another request won the insert. Never upsert over its status or expiry.
  const { data: existing, error: readError } = await adminClient.from("class_recordings")
    .select(uploadColumns).eq("id", id).single();
  if (readError) throw new Error(readError.message);
  return existing as UploadRow;
};
