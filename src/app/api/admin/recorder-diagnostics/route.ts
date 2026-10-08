import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isFounder, resolveAccountRole } from "@/lib/roles";
import { normalizeRecorderDiagnostics, recorderDiagnosticsRetentionMs } from "@/lib/recorderDiagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);
  if (!actor || !isFounder(resolveAccountRole(actor))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }
  const tutorId = request.nextUrl.searchParams.get("tutorId") ?? "";
  const deviceId = request.nextUrl.searchParams.get("deviceId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tutorId) || !deviceId || deviceId.length > 128) {
    return NextResponse.json({ error: "Invalid recorder." }, { status: 400 });
  }
  const { data, error } = await getAdminClient().from("recorder_diagnostics")
    .select("report, received_at").eq("tutor_id", tutorId).eq("device_id", deviceId)
    .gte("received_at", new Date(Date.now() - recorderDiagnosticsRetentionMs).toISOString()).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load diagnostics." }, { status: 503 });
  return NextResponse.json({
    receivedAt: data?.received_at ?? null,
    report: normalizeRecorderDiagnostics(data?.report),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
