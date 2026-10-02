import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { isZenWorkerAuthorized } from "@/lib/zenGatewayClient";
import { syncZenMode, ZenBusyError } from "@/lib/zenModeServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Gateway notifications contain IDs only; current policy and voice are read server-side. */
export async function POST(request: NextRequest) {
  if (!isZenWorkerAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.memberIds) || body.memberIds.length < 1 || body.memberIds.length > 20 ||
      !body.memberIds.every((id: unknown) => typeof id === "string" && /^\d{17,20}$/.test(id))) {
    return NextResponse.json({ error: "Invalid voice notification." }, { status: 400 });
  }
  try {
    const result = await syncZenMode(getAdminClient(), undefined, { memberIds: body.memberIds, voicesOnly: true });
    return NextResponse.json(result, { status: result.problems.length ? 503 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZenBusyError ? "Zen mode is updating." : "Voice update failed." },
      { status: error instanceof ZenBusyError ? 409 : 503 });
  }
}
