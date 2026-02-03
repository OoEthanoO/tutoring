import { NextResponse } from "next/server";

export async function GET() {
  const iteration = process.env.SERVER_ITERATION ?? "1";
  return NextResponse.json({ iteration });
}
