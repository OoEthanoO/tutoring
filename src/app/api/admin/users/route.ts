import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { resolveRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const response = NextResponse.next();
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
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
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveRole(user.email) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const search = request.nextUrl.searchParams.get("email")?.toLowerCase() ?? "";
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const perPage = Math.min(
    200,
    Number(request.nextUrl.searchParams.get("perPage") ?? "200")
  );

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error: listError } = await adminClient.auth.admin.listUsers({
    page,
    perPage,
  });

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to fetch users." },
      { status: 500 }
    );
  }

  const users = data.users
    .filter((item) =>
      search ? item.email?.toLowerCase().includes(search) : true
    )
    .map((item) => ({
      id: item.id,
      email: item.email,
      createdAt: item.created_at,
      lastSignInAt: item.last_sign_in_at,
      fullName: item.user_metadata?.full_name ?? "",
    }));

  return NextResponse.json({ users, total: data.total });
}
