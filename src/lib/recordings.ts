import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFounder, type UserRole } from "@/lib/roles";
import { recordingExpiresAtMs } from "@/lib/recorderPolicy";
import { deleteRecordingObject, recordingsBucket } from "@/lib/recordingStorage";

export { recordingsBucket };

export const buildRecordingStoragePath = (
  courseId: string,
  classId: string,
  recordingId: string
) => `${courseId}/${classId}/${recordingId}.mp4`;

export type ClassRecordingRow = {
  id: string;
  class_id: string;
  course_id: string;
  tutor_id: string;
  status: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | string | null;
  duration_seconds: number | null;
  recording_started_at: string | null;
  recording_ended_at: string | null;
  uploaded_at: string | null;
  expires_at: string | null;
};

/** A recording students may watch: uploaded, and not yet past its 7-day life. */
export const isRecordingWatchable = (
  recording: Pick<ClassRecordingRow, "status" | "expires_at">,
  nowMs: number
): boolean => {
  if (recording.status !== "ready" || !recording.expires_at) {
    return false;
  }
  const expiresMs = new Date(recording.expires_at).getTime();
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
};

/**
 * Who may watch a recording: founders, the course's tutor and co-tutor, and
 * students enrolled in the course. Nobody else — that is the whole point of
 * serving recordings through the API rather than as storage links.
 */
export const canViewRecording = async (
  adminClient: SupabaseClient,
  viewer: { id: string; role: UserRole },
  recording: { course_id: string; tutor_id: string }
): Promise<boolean> => {
  if (isFounder(viewer.role) || recording.tutor_id === viewer.id) {
    return true;
  }
  const [{ data: course }, { data: enrollment }] = await Promise.all([
    adminClient
      .from("courses")
      .select("created_by, co_tutor_id")
      .eq("id", recording.course_id)
      .maybeSingle(),
    adminClient
      .from("course_enrollments")
      .select("id")
      .eq("course_id", recording.course_id)
      .eq("student_id", viewer.id)
      .maybeSingle(),
  ]);
  if (course && (course.created_by === viewer.id || course.co_tutor_id === viewer.id)) {
    return true;
  }
  return Boolean(enrollment);
};

/**
 * Whether a tutor may upload a recording for a class: they teach (or co-teach)
 * its course. Returns the course id for convenience.
 */
export const findTeachableClass = async (
  adminClient: SupabaseClient,
  tutorId: string,
  classId: string
): Promise<{ courseId: string; startsAt: string; durationHours: number | string | null } | null> => {
  const { data: classRow } = await adminClient
    .from("course_classes")
    .select("id, course_id, starts_at, duration_hours, course:courses(created_by, co_tutor_id, deleted_at)")
    .eq("id", classId)
    .maybeSingle();
  if (!classRow) {
    return null;
  }
  // Supabase types a to-one embed as an array; it is a single object at runtime.
  const course = (Array.isArray(classRow.course) ? classRow.course[0] : classRow.course) as
    | { created_by: string | null; co_tutor_id: string | null; deleted_at: string | null }
    | null;
  if (!course || course.deleted_at) {
    return null;
  }
  if (course.created_by !== tutorId && course.co_tutor_id !== tutorId) {
    return null;
  }
  return {
    courseId: String(classRow.course_id),
    startsAt: String(classRow.starts_at),
    durationHours: classRow.duration_hours ?? null,
  };
};

// --- Playback tokens ---------------------------------------------------------
//
// <video> requests cannot carry an Authorization header and the recorder-side
// bearer tokens must never reach the browser, so the stream endpoint takes a
// short-lived HMAC token bound to one viewer and one recording instead. Nothing
// in it is secret; it simply cannot be forged or reused for another file.

const playbackTokenSecret =
  process.env.RECORDING_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Long enough to sit through the longest class without the player breaking. */
export const playbackTokenTtlMs = 6 * 60 * 60 * 1000;

type PlaybackTokenPayload = { r: string; u: string; e: number };

const base64Url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const signPayload = (encodedPayload: string) =>
  base64Url(crypto.createHmac("sha256", playbackTokenSecret).update(encodedPayload).digest());

export const signPlaybackToken = ({
  recordingId,
  userId,
  nowMs,
}: {
  recordingId: string;
  userId: string;
  nowMs: number;
}): { token: string; expiresAtMs: number } => {
  if (!playbackTokenSecret) {
    throw new Error("Missing RECORDING_TOKEN_SECRET.");
  }
  const expiresAtMs = nowMs + playbackTokenTtlMs;
  const payload: PlaybackTokenPayload = { r: recordingId, u: userId, e: expiresAtMs };
  const encoded = base64Url(JSON.stringify(payload));
  return { token: `${encoded}.${signPayload(encoded)}`, expiresAtMs };
};

export const verifyPlaybackToken = (
  token: string,
  recordingId: string,
  nowMs: number
): { userId: string } | null => {
  if (!playbackTokenSecret || !token) {
    return null;
  }
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }
  const expected = signPayload(encoded);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }
  let payload: PlaybackTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as PlaybackTokenPayload;
  } catch {
    return null;
  }
  if (payload.r !== recordingId || typeof payload.u !== "string" || !payload.u) {
    return null;
  }
  if (typeof payload.e !== "number" || payload.e <= nowMs) {
    return null;
  }
  return { userId: payload.u };
};

// --- Lifecycle ---------------------------------------------------------------

/** Mark an upload finished and start its 7-day clock. */
export const markRecordingReady = async (
  adminClient: SupabaseClient,
  recordingId: string,
  { nowMs, sizeBytes, durationSeconds }: { nowMs: number; sizeBytes: number | null; durationSeconds: number | null }
) => {
  const uploadedAt = new Date(nowMs).toISOString();
  return adminClient
    .from("class_recordings")
    .update({
      status: "ready",
      uploaded_at: uploadedAt,
      expires_at: new Date(recordingExpiresAtMs(nowMs)).toISOString(),
      ...(sizeBytes !== null ? { size_bytes: sizeBytes } : {}),
      ...(durationSeconds !== null ? { duration_seconds: durationSeconds } : {}),
    })
    .eq("id", recordingId);
};

/** Uploads that never completed are given up on after this long. */
const staleUploadMs = 48 * 60 * 60 * 1000;

export type RecordingExpiryResult = {
  expiredCount: number;
  failedUploadCount: number;
  errors: string[];
};

/**
 * Delete every recording past its expiry and mark abandoned uploads failed.
 * Called from the class-reminders cron tick; deleting the storage object comes
 * first so a row is only ever marked expired once its bytes are really gone.
 */
export const expireClassRecordings = async (
  adminClient: SupabaseClient,
  nowMs: number
): Promise<RecordingExpiryResult> => {
  const result: RecordingExpiryResult = { expiredCount: 0, failedUploadCount: 0, errors: [] };
  const nowIso = new Date(nowMs).toISOString();

  const { data: expiredRows, error: expiredError } = await adminClient
    .from("class_recordings")
    .select("id, storage_bucket, storage_path")
    .eq("status", "ready")
    .lte("expires_at", nowIso)
    .limit(200);
  if (expiredError) {
    result.errors.push(`Failed to list expired recordings: ${expiredError.message}`);
  }

  for (const row of expiredRows ?? []) {
    try {
      await deleteRecordingObject(String(row.storage_path));
    } catch (error) {
      result.errors.push(
        `Failed to delete recording ${row.id}: ${error instanceof Error ? error.message : "unknown error"}`
      );
      continue;
    }
    const { error: updateError } = await adminClient
      .from("class_recordings")
      .update({ status: "expired", deleted_at: nowIso })
      .eq("id", row.id);
    if (updateError) {
      result.errors.push(`Failed to mark recording ${row.id} expired: ${updateError.message}`);
      continue;
    }
    result.expiredCount += 1;
  }

  const { data: staleRows } = await adminClient
    .from("class_recordings")
    .select("id, storage_bucket, storage_path")
    .eq("status", "uploading")
    .lte("created_at", new Date(nowMs - staleUploadMs).toISOString())
    .limit(100);
  for (const row of staleRows ?? []) {
    // Best effort: a partial object may or may not exist.
    try {
      await deleteRecordingObject(String(row.storage_path));
    } catch {
      // Nothing to delete, or storage unreachable; the row is marked failed either way.
    }
    const { error: updateError } = await adminClient
      .from("class_recordings")
      .update({ status: "failed", deleted_at: nowIso })
      .eq("id", row.id);
    if (updateError) {
      result.errors.push(`Failed to mark recording ${row.id} failed: ${updateError.message}`);
      continue;
    }
    result.failedUploadCount += 1;
  }

  return result;
};
