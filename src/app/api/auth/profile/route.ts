import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getSessionUser } from "@/lib/authServer";

const SESSION_COOKIE = "session";

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { fullName?: string; discordUsername?: string; legalName?: string }
    | null;

  if (body?.fullName === undefined && body?.discordUsername === undefined && body?.legalName === undefined) {
    return NextResponse.json(
      { error: "No profile fields provided to update." },
      { status: 400 }
    );
  }

  if (body?.discordUsername !== undefined) {
    return NextResponse.json(
      {
        error:
          "Manual Discord username updates are disabled. Use Connect Discord.",
      },
      { status: 400 }
    );
  }

  const updates: Record<string, string | null> = {};

  if (body?.fullName !== undefined) {
    const fullName = body.fullName.trim();
    if (!fullName) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    updates.full_name = fullName;
  }

  if (body?.legalName !== undefined) {
    updates.legal_name = body.legalName.trim() || null;
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("app_users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to update profile." },
      { status: 500 }
    );
  }

  if (updates.full_name) {
    await Promise.all([
      adminClient
        .from("courses")
        .update({ created_by_name: updates.full_name })
        .eq("created_by", user.id),
      adminClient
        .from("course_enrollments")
        .update({ student_name: updates.full_name })
        .eq("student_id", user.id),
      adminClient
        .from("course_enrollment_requests")
        .update({ student_name: updates.full_name })
        .eq("student_id", user.id),
    ]);
  }

  return NextResponse.json({ success: true });
}
