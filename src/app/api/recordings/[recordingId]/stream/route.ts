import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { isRecordingWatchable, verifyPlaybackToken } from "@/lib/recordings";
import { createRecordingDownloadUrl, recordingStorageConfigured } from "@/lib/recordingStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Proxy mode caps each response at this many bytes. Browsers ask for open-ended
 * ranges ("bytes=0-") and happily accept a shorter 206, then ask for the rest.
 */
const maxChunkBytes = 4 * 1024 * 1024;

/** Fetch destinations a media element uses; anything else is a direct download attempt. */
const allowedFetchDestinations = new Set(["video", "audio", "empty", ""]);

/**
 * Whether to redirect the player to a short-lived presigned URL (default; the
 * bytes flow straight from the bucket, costing no Vercel bandwidth) or to proxy
 * them through this function (`RECORDINGS_STREAM_MODE=proxy`; the bucket URL
 * is never exposed at all, at the cost of Vercel bandwidth).
 */
const streamMode = process.env.RECORDINGS_STREAM_MODE === "proxy" ? "proxy" : "redirect";

/**
 * Stream a recording to an authorized viewer.
 *
 * The playback token is checked on every request (browsers re-request this URL
 * for each byte range, following the redirect afresh each time), the bucket
 * URL is presigned per request and expires in two minutes, responses are
 * inline and uncacheable, and requests that are not coming from a media
 * element (a tab navigation, a "save link as") are refused. This cannot stop
 * someone from screen-recording their own screen — nothing can — but it
 * removes every "download" affordance and makes the link useless to anyone it
 * is passed to.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  const { recordingId } = await params;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const nowMs = Date.now();
  const tokenPayload = verifyPlaybackToken(token, recordingId, nowMs);
  if (!tokenPayload) {
    return NextResponse.json({ error: "Invalid or expired playback token." }, { status: 401 });
  }

  const fetchDestination = (request.headers.get("sec-fetch-dest") ?? "").toLowerCase();
  if (!allowedFetchDestinations.has(fetchDestination)) {
    return NextResponse.json(
      { error: "Recordings can only be watched in the YanLearn player." },
      { status: 403 }
    );
  }

  if (!recordingStorageConfigured()) {
    return NextResponse.json({ error: "Recording storage is not configured." }, { status: 503 });
  }

  const adminClient = getAdminClient();
  const { data: recording } = await adminClient
    .from("class_recordings")
    .select("id, status, expires_at, storage_bucket, storage_path, content_type, size_bytes")
    .eq("id", recordingId)
    .maybeSingle();
  if (!recording || !isRecordingWatchable(recording, nowMs)) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const contentType = String(recording.content_type || "video/mp4");
  let signedUrl: string;
  try {
    signedUrl = await createRecordingDownloadUrl(String(recording.storage_path), contentType);
  } catch {
    return NextResponse.json({ error: "Unable to open the recording." }, { status: 500 });
  }

  if (streamMode === "redirect") {
    const response = NextResponse.redirect(signedUrl, 302);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // --- Proxy mode --------------------------------------------------------------
  const rangeHeader = request.headers.get("range");
  let start = 0;
  let requestedEnd = Number.POSITIVE_INFINITY;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      return new NextResponse(null, { status: 416 });
    }
    const totalKnown = Number(recording.size_bytes);
    if (match[1]) {
      start = Number.parseInt(match[1], 10);
      if (match[2]) {
        requestedEnd = Number.parseInt(match[2], 10);
      }
    } else if (match[2] && Number.isFinite(totalKnown) && totalKnown > 0) {
      // Suffix range: the last N bytes.
      start = Math.max(0, totalKnown - Number.parseInt(match[2], 10));
    }
  }
  const end = Math.min(requestedEnd, start + maxChunkBytes - 1);

  const upstream = await fetch(signedUrl, {
    headers: { Range: `bytes=${start}-${Number.isFinite(end) ? end : ""}` },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Unable to read the recording." }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  if (upstream.status === 206) {
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) {
      headers.set("Content-Range", contentRange);
    }
    return new Response(upstream.body, { status: 206, headers });
  }

  // Storage ignored the range and sent the whole object.
  return new Response(upstream.body, { status: 200, headers });
}
