import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { classEndMs } from "@/lib/classTiming";
import { getRecorderUser } from "@/lib/recorderAuth";
import { buildRecordingStoragePath, findTeachableClass, recordingsBucket } from "@/lib/recordings";
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

  const recordingId = crypto.randomUUID();
  const storagePath = buildRecordingStoragePath(teachable.courseId, classId, recordingId);
  const uploadReason = String(body?.uploadReason ?? "").trim();
  const durationSeconds = Number(body?.durationSeconds);
  const sizeBytes = Number(body?.sizeBytes);

  const { error: insertError } = await adminClient.from("class_recordings").insert({
    id: recordingId,
    class_id: classId,
    course_id: teachable.courseId,
    tutor_id: user.id,
    status: "uploading",
    storage_bucket: recordingsBucket,
    storage_path: storagePath,
    content_type: "video/mp4",
    size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.round(sizeBytes) : null,
    duration_seconds:
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
    recording_started_at: body?.startedAt ? new Date(body.startedAt).toISOString() : null,
    recording_ended_at: body?.endedAt ? new Date(body.endedAt).toISOString() : null,
    upload_reason: allowedUploadReasons.has(uploadReason) ? uploadReason : null,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  let uploadUrl: string;
  try {
    uploadUrl = await createRecordingUploadUrl(storagePath, "video/mp4");
  } catch (error) {
    await adminClient.from("class_recordings").delete().eq("id", recordingId);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create an upload URL." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    recordingId,
    uploadUrl,
    storagePath,
    contentType: "video/mp4",
  });
}
