import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { classEndMs } from "@/lib/classTiming";
import { getRecorderUser } from "@/lib/recorderAuth";
import { findTeachableClass } from "@/lib/recordings";
import { getOrCreateRecordingUpload } from "@/lib/recordingUploads";
import { createRecordingUploadUrl, recordingStorageConfigured } from "@/lib/recordingStorage";

/** Uploads are accepted for classes that ended up to this long ago (crash recovery). */
const uploadGraceMs = 7 * 24 * 60 * 60 * 1000;

const allowedUploadReasons = new Set(["tutor_confirmed", "channel_deleted", "recovered"]);

/**
 * Start an upload: create the recording row and hand the desktop app a
 * presigned PUT URL for the private S3-compatible bucket. The app PUTs the file
 * there directly (Vercel functions cannot proxy a multi-hundred-megabyte body),
 * then calls /complete so the row becomes watchable.
 */
export async function POST(request: NextRequest) {
  const user = await getRecorderUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!recordingStorageConfigured()) {
    return NextResponse.json(
      { error: "Recording storage is not configured on the server. Tell a founder." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        classId?: string;
        startedAt?: string;
        endedAt?: string;
        durationSeconds?: number;
        sizeBytes?: number;
        uploadReason?: string;
      }
    | null;
  const classId = String(body?.classId ?? "").trim();
  if (!classId) {
    return NextResponse.json({ error: "Missing class id." }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const teachable = await findTeachableClass(adminClient, user.id, classId);
  if (!teachable) {
    return NextResponse.json({ error: "You do not teach this class." }, { status: 403 });
  }

  const nowMs = Date.now();
  const startsAtMs = new Date(teachable.startsAt).getTime();
  const endsAtMs = classEndMs(startsAtMs, teachable.durationHours);
  if (nowMs < startsAtMs - 15 * 60 * 1000 || nowMs > endsAtMs + uploadGraceMs) {
    return NextResponse.json(
      { error: "This class is not within the upload window." },
      { status: 400 }
    );
  }

  const uploadReason = String(body?.uploadReason ?? "").trim();
  const durationSeconds = Number(body?.durationSeconds);
  const sizeBytes = Number(body?.sizeBytes);
  const startedAtMs = body?.startedAt ? Date.parse(body.startedAt) : null;
  const endedAtMs = body?.endedAt ? Date.parse(body.endedAt) : null;
  if (
    (startedAtMs !== null && !Number.isFinite(startedAtMs)) ||
    (endedAtMs !== null && !Number.isFinite(endedAtMs)) ||
    (startedAtMs !== null && endedAtMs !== null && endedAtMs < startedAtMs)
  ) {
    return NextResponse.json({ error: "Invalid recording timestamps." }, { status: 400 });
  }
  const input = {
    class_id: classId,
    course_id: teachable.courseId,
    tutor_id: user.id,
    size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.round(sizeBytes) : null,
    duration_seconds:
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
    recording_started_at: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    recording_ended_at: endedAtMs === null ? null : new Date(endedAtMs).toISOString(),
    upload_reason: allowedUploadReasons.has(uploadReason) ? uploadReason : null,
  };

  try {
    const recording = await getOrCreateRecordingUpload(adminClient, input);
    if (
      recording.status === "expired" ||
      (recording.expires_at && Date.parse(recording.expires_at) <= nowMs)
    ) {
      return NextResponse.json({ error: "This recording has expired." }, { status: 400 });
    }
    if (recording.status === "failed") {
      // The abandoned-upload sweep may have cleaned up an earlier attempt.
      const { error } = await adminClient.from("class_recordings")
        .update({ status: "uploading", deleted_at: null, created_at: new Date(nowMs).toISOString() })
        .eq("id", recording.id).eq("status", "failed");
      if (error) throw new Error(error.message);
    }
    // Keep returning a URL for older Recorder versions. They may PUT the same
    // capture again, but complete the same row without resetting its expiry.
    const uploadUrl = await createRecordingUploadUrl(recording.storage_path, "video/mp4");
    return NextResponse.json({
      recordingId: recording.id,
      uploadUrl,
      storagePath: recording.storage_path,
      contentType: "video/mp4",
      alreadyReady: recording.status === "ready",
    });
  } catch (error) {
    // Retain the row if signing fails; the next request resumes it.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create an upload URL." },
      { status: 500 }
    );
  }
}
