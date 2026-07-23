import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("banned_emails")
    .select("email, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch banned emails." },
      { status: 500 }
    );
  }

  return NextResponse.json({ bannedEmails: data });
}

export async function POST(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("banned_emails")
    .insert({ email });

  if (error) {
    // 23505 is unique violation
    if (error.code === '23505') {
      return NextResponse.json(
        { error: "This email is already banned." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Failed to ban email: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email });
}

export async function DELETE(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("banned_emails")
    .delete()
    .eq("email", email);

  if (error) {
    return NextResponse.json(
      { error: "Failed to remove email from ban list." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email });
}
