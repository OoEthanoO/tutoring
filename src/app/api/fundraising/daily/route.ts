import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/authServer";

export async function GET() {
  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("daily_donations")
    .select("date, amount")
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data });
}
