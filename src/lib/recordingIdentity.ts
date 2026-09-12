export type RecordingIdentity = {
  class_id: string;
  tutor_id: string;
  recording_started_at: string | null;
  recording_ended_at: string | null;
  size_bytes: number | string | null;
  duration_seconds: number | null;
};

/** Match a capture, not just its class: co-tutors and separate parts stay distinct. */
export const recordingFingerprint = (recording: RecordingIdentity): string | null => {
  const started = Date.parse(recording.recording_started_at ?? "");
  const ended = Date.parse(recording.recording_ended_at ?? "");
  const size = Number(recording.size_bytes);
  const duration = Number(recording.duration_seconds);
  if (
    !recording.class_id || !recording.tutor_id ||
    !Number.isFinite(started) || !Number.isFinite(ended) || ended < started ||
    !Number.isSafeInteger(size) || size <= 0 ||
    !Number.isSafeInteger(duration) || duration <= 0
  ) {
    return null;
  }
  return JSON.stringify([recording.class_id, recording.tutor_id, started, ended, size, duration]);
};

/** Keep the original upload when old clients have already created duplicate rows. */
export const uniqueRecordings = <T extends RecordingIdentity & {
  id: string;
  uploaded_at: string | null;
}>(recordings: T[]): T[] => {
  const originalByCapture = new Map<string, T>();
  for (const row of recordings) {
    const key = recordingFingerprint(row);
    if (!key) continue; // Incomplete metadata is not evidence of a duplicate.
    const original = originalByCapture.get(key);
    const uploaded = Date.parse(row.uploaded_at ?? "") || Number.POSITIVE_INFINITY;
    const originalUploaded = Date.parse(original?.uploaded_at ?? "") || Number.POSITIVE_INFINITY;
    if (!original || uploaded < originalUploaded || (uploaded === originalUploaded && row.id < original.id)) {
      originalByCapture.set(key, row);
    }
  }
  return recordings.filter((row) => {
    const key = recordingFingerprint(row);
    return !key || originalByCapture.get(key)?.id === row.id;
  });
};
