import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";
import { getMaintenanceMode, setMaintenanceMode } from "@/lib/siteSettings";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const enabled = await getMaintenanceMode();
  return NextResponse.json({ enabled });
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { enabled?: boolean }
    | null;

  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json(
      { error: "Missing enabled boolean." },
      { status: 400 }
    );
  }

  await setMaintenanceMode(body.enabled, user.id);
  return NextResponse.json({ enabled: body.enabled });
}
