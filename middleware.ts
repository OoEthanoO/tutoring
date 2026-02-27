import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const guardedPaths = ["/onboarding"];
const maintenancePath = "/maintenance";
const founderEmail =
  (process.env.NEXT_PUBLIC_FOUNDER_EMAIL ?? "ethans.coding.class@gmail.com")
    .trim()
    .toLowerCase();

const readMaintenanceMode = async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return false;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/site_settings?id=eq.true&select=maintenance_mode`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return false;
  }

  const rows = (await response.json().catch(() => [])) as Array<{
    maintenance_mode?: boolean | null;
  }>;
  return rows[0]?.maintenance_mode === true;
};

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
};

const isFounderSession = async (request: NextRequest) => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return false;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return false;
  }

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const sessionParams = new URLSearchParams({
    select: "user_id",
    token_hash: `eq.${tokenHash}`,
    expires_at: `gt.${nowIso}`,
    limit: "1",
  });
  const sessionResponse = await fetch(
    `${supabaseUrl}/rest/v1/app_sessions?${sessionParams.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!sessionResponse.ok) {
    return false;
  }

  const sessions = (await sessionResponse.json().catch(() => [])) as Array<{
    user_id?: string | null;
  }>;
  const userId = sessions[0]?.user_id;
  if (!userId) {
    return false;
  }

  const userParams = new URLSearchParams({
    select: "email,role",
    id: `eq.${userId}`,
    limit: "1",
  });
  const userResponse = await fetch(
    `${supabaseUrl}/rest/v1/app_users?${userParams.toString()}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!userResponse.ok) {
    return false;
  }

  const users = (await userResponse.json().catch(() => [])) as Array<{
    email?: string | null;
    role?: string | null;
  }>;
  const user = users[0];
  if (!user) {
    return false;
  }

  const role = String(user.role ?? "").toLowerCase();
  const email = String(user.email ?? "").toLowerCase();
  return role === "founder" || email === founderEmail;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const maintenanceEnabled = await readMaintenanceMode();
  const isFounder = maintenanceEnabled ? await isFounderSession(request) : false;
  const isPublicMaintenanceAccess = pathname === "/login" || pathname === maintenancePath;

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

  const response = NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value;
      },
      set(name, value, options) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name, options) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const fullName = user.user_metadata?.full_name;
  if (!fullName || String(fullName).trim().length === 0) {
    return response;
  }

  if (pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
