import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";

export async function GET(
  request: NextRequest,
  { params }: { params: { studentId: string } | Promise<{ studentId: string }> }
) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role);
  if (role !== "founder" && role !== "executive") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const resolvedParams = await params;
  const studentId = resolvedParams?.studentId ?? "";
  if (!studentId) {
    return NextResponse.json({ error: "Missing student id." }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("student_applications")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ application: data });
}
