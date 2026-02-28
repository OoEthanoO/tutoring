import { NextResponse } from "next/server";
import { fetchFundraisingRaisedAmount } from "@/lib/fundraising";

export async function GET() {
  const raised = await fetchFundraisingRaisedAmount();
  return NextResponse.json({ raised });
}
