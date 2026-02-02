import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveRole } from "@/lib/roles";

const guardedPaths = ["/admin", "/tutor", "/student", "/onboarding"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
    if (!pathname.startsWith("/onboarding")) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
    return response;
  }

  const role = resolveRole(user.email);

  if (pathname.startsWith("/admin") && role !== "founder") {
    return NextResponse.redirect(new URL("/student", request.url));
  }

  if (pathname.startsWith("/tutor") && role !== "founder") {
    return NextResponse.redirect(new URL("/student", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/tutor/:path*", "/student/:path*", "/onboarding"],
};
