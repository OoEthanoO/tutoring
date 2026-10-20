import { isFounder as hasManagementAccess, resolveAccountRole, type AccountRole } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { recorderCorsHeaders } from "@/lib/recorderCors";

const guardedPaths = ["/onboarding"];
const maintenancePath = "/maintenance";

// Runs on every page request. The database runs on this server, so while it
// restarts a lookup must fail quickly and count as "no" instead of failing
// the page.
const readRows = async <Row>(path: string): Promise<Row[]> => {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return [];
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return [];
    }
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? (rows as Row[]) : [];
  } catch {
    return [];
  }
};

const readMaintenanceMode = async () => {
  const rows = await readRows<{ maintenance_mode?: boolean | null }>(
    "site_settings?id=eq.true&select=maintenance_mode"
  );
  return rows[0]?.maintenance_mode === true;
};

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
};

// The account behind the session cookie, checked the way getSessionUser in
// src/lib/authServer.ts does (unexpired app_sessions row for the token's hash).
const readSessionUser = async <User>(request: NextRequest, columns: string): Promise<User | null> => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const sessionParams = new URLSearchParams({
    select: "user_id",
    token_hash: `eq.${tokenHash}`,
    expires_at: `gt.${nowIso}`,
    limit: "1",
  });
  const sessions = await readRows<{ user_id?: string | null }>(
    `app_sessions?${sessionParams.toString()}`
  );
  const userId = sessions[0]?.user_id;
  if (!userId) {
    return null;
  }

  const userParams = new URLSearchParams({ select: columns, id: `eq.${userId}`, limit: "1" });
  const users = await readRows<User>(`app_users?${userParams.toString()}`);
  return users[0] ?? null;
};

const isFounderSession = async (request: NextRequest) => {
  const user = await readSessionUser<AccountRole>(request, "email,role,custom_role,custom_roles(role_level)");
  return user ? hasManagementAccess(resolveAccountRole(user)) : false;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The desktop recorder calls these from its webview, which is a different
  // origin, so they need CORS. Answered before anything else: the app ticks
  // every 2 s during a class and must not pay for a maintenance-mode lookup.
  if (pathname.startsWith("/api/recorder")) {
    const corsHeaders = recorderCorsHeaders(request.headers.get("origin"));
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders ?? undefined });
    }
    const response = NextResponse.next();
    for (const [name, value] of Object.entries(corsHeaders ?? {})) {
      response.headers.set(name, value);
    }
    return response;
  }

  const maintenanceEnabled = await readMaintenanceMode();
  const isFounder = maintenanceEnabled ? await isFounderSession(request) : false;
  const isPublicMaintenanceAccess = pathname === "/login" || pathname === "/login/" || pathname === maintenancePath || pathname === maintenancePath + "/" || pathname === "/recorder" || pathname.startsWith("/recorder/");

  const host = request.headers.get("host");

  if (host === "class.ethanyanxu.com") {
    const url = request.nextUrl.clone();
    url.host = "learn.ethanyanxu.com";
    url.port = ""; // Ensure standard HTTPS port for the new domain
    url.protocol = "https:";
    url.searchParams.set("redirected", "true");
    return NextResponse.redirect(url, 301); // 301 Permanent Redirect
  }

  if (maintenanceEnabled && !isFounder && !isPublicMaintenanceAccess) {
    return NextResponse.redirect(new URL(maintenancePath, request.url));
  }

  if (maintenanceEnabled && isFounder && pathname === maintenancePath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!maintenanceEnabled && pathname === maintenancePath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const shouldGuard = guardedPaths.some((path) => pathname.startsWith(path));

  if (!shouldGuard) {
    return NextResponse.next();
  }

  // Onboarding asks a signed-in account for the name it is missing.
  const user = await readSessionUser<{ full_name?: string | null }>(request, "full_name");
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user.full_name && user.full_name.trim().length > 0) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)", "/api/recorder/:path*"],
};
