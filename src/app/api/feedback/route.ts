import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { message?: string }
    | null;

  const message = body?.message?.trim() ?? "";
  if (message.length < 10 || message.length > 2000) {
    return NextResponse.json(
      { error: "Message must be between 10 and 2000 characters." },
      { status: 400 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await adminClient.from("feedback_submissions").insert({
    user_id: user.id,
    user_email: user.email,
    user_name: user.full_name ?? null,
    contact_email: null,
    message,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to save feedback." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
