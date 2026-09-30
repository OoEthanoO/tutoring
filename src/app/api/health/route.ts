import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Process/readiness probe; no credentials or account data are exposed. */
export async function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return NextResponse.json({
    status: configured ? "ok" : "not_configured",
    commit: process.env.YANLEARN_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    hosting: process.env.YANLEARN_HOST || (process.env.VERCEL ? "vercel" : "local"),
  }, { status: configured ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
