import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";
import { canViewRecording, isRecordingWatchable, signPlaybackToken } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/**
 * Issue a short-lived token that lets this viewer stream one recording. The
 * token is bound to the viewer and the recording; the stream endpoint checks
 * it on every byte-range request.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { recordingId } = await params;
  const adminClient = getAdminClient();
  const { data: recording } = await adminClient
    .from("class_recordings")
    .select("id, course_id, tutor_id, status, expires_at")
    .eq("id", recordingId)
    .maybeSingle();
  const nowMs = Date.now();
  if (!recording || !isRecordingWatchable(recording, nowMs)) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  const allowed = await canViewRecording(adminClient, { id: user.id, role }, recording);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { token, expiresAtMs } = signPlaybackToken({ recordingId, userId: user.id, nowMs });
  return NextResponse.json({
    streamUrl: `/api/recordings/${recordingId}/stream?t=${encodeURIComponent(token)}`,
    expiresAtMs,
  });
}
