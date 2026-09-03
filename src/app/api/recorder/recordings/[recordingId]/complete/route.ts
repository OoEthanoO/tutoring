import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { getRecorderUser } from "@/lib/recorderAuth";
import { markRecordingReady } from "@/lib/recordings";
import { getRecordingObjectSize } from "@/lib/recordingStorage";

/**
 * The desktop app finished PUTting the file. Verify the object is really in the
 * bucket, then make the recording watchable and start its 7-day clock.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  const user = await getRecorderUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { recordingId } = await params;
  if (!recordingId) {
    return NextResponse.json({ error: "Missing recording id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { sizeBytes?: number; durationSeconds?: number }
    | null;

  const adminClient = getAdminClient();
  const { data: recording } = await adminClient
    .from("class_recordings")
    .select("id, tutor_id, status, storage_bucket, storage_path, class_id")
    .eq("id", recordingId)
    .maybeSingle();
  if (!recording || recording.tutor_id !== user.id) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  if (recording.status === "ready") {
    return NextResponse.json({ ok: true, alreadyReady: true });
  }
  if (recording.status !== "uploading") {
    return NextResponse.json({ error: "This recording can no longer be completed." }, { status: 409 });
  }

  // Confirm the bytes actually landed before promising students a video.
  let storedSize: number | null;
  try {
    storedSize = await getRecordingObjectSize(String(recording.storage_path));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Storage check failed." },
      { status: 500 }
    );
  }
  if (storedSize === null || storedSize <= 0) {
    return NextResponse.json(
      { error: "The uploaded file was not found in storage. Retry the upload." },
      { status: 409 }
    );
  }
  const reportedSize = Number(body?.sizeBytes);
  const sizeBytes = storedSize > 0
    ? Math.round(storedSize)
    : Number.isFinite(reportedSize) && reportedSize > 0
      ? Math.round(reportedSize)
      : null;
  const reportedDuration = Number(body?.durationSeconds);
  const durationSeconds =
    Number.isFinite(reportedDuration) && reportedDuration > 0 ? Math.round(reportedDuration) : null;

  const nowMs = Date.now();
  const { error: updateError } = await markRecordingReady(adminClient, recordingId, {
    nowMs,
    sizeBytes,
    durationSeconds,
  });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const nowIso = new Date(nowMs).toISOString();
  await adminClient.from("recorder_class_sessions").upsert(
    {
      class_id: recording.class_id,
      tutor_id: user.id,
      last_seen_at: nowIso,
      last_state: "finished",
      finished_at: nowIso,
      finish_reason: "uploaded",
    },
    { onConflict: "class_id,tutor_id" }
  );

  return NextResponse.json({ ok: true });
}
