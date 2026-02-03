import { NextResponse } from "next/server";
import { iteration } from "@/lib/iteration";

export async function GET() {
  return NextResponse.json({ iteration });
}
