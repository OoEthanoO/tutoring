import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { getRecorderUser } from "@/lib/recorderAuth";
import { normalizeRecorderDiagnostics, readDiagnosticsBody } from "@/lib/recorderDiagnostics";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getRecorderUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let body: { deviceId?: unknown; report?: unknown } | null;
  try {
    body = await readDiagnosticsBody(request) as typeof body;
  } catch (error) {
    return NextResponse.json({ error: "Invalid diagnostics report." }, { status: error instanceof RangeError ? 413 : 400 });
  }
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  const report = normalizeRecorderDiagnostics(body?.report);
  if (!deviceId || deviceId.length > 128 || !report) {
    return NextResponse.json({ error: "Invalid diagnostics report." }, { status: 400 });
  }
  const db = getAdminClient();
  // Bind the report to this authenticated tutor's existing install, never an
  // arbitrary tutor ID supplied by the client. This endpoint changes no heartbeat.
  const { data: session, error: sessionError } = await db.from("recorder_sessions")
    .select("device_id").eq("tutor_id", user.id).eq("device_id", deviceId).maybeSingle();
  if (sessionError) return NextResponse.json({ error: "Diagnostics are temporarily unavailable." }, { status: 503 });
  if (!session) return NextResponse.json({ error: "Recorder must check in first." }, { status: 403 });
  const { error } = await db.from("recorder_diagnostics").upsert({
    tutor_id: user.id, device_id: deviceId, report, received_at: new Date().toISOString(),
  }, { onConflict: "tutor_id,device_id" });
  if (error) return NextResponse.json({ error: "Could not save diagnostics." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
