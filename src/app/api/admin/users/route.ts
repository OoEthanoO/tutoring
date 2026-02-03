import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { resolveRoleByEmail, resolveUserRole } from "@/lib/roles";

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

  if (resolveRoleByEmail(user.email) !== "founder") {
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
      role: resolveUserRole(item.email, item.user_metadata?.role ?? null),
      donationLink: "",
    }));

  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    const { data: donationData } = await adminClient
      .from("tutor_profiles")
      .select("user_id, donation_link")
      .in("user_id", userIds);

    const donationMap = new Map(
      (donationData ?? []).map((row) => [row.user_id, row.donation_link ?? ""])
    );

    users.forEach((user) => {
      user.donationLink = donationMap.get(user.id) ?? "";
    });
  }

  return NextResponse.json({ users, total: data.total });
}

export async function PATCH(request: NextRequest) {
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

  if (resolveRoleByEmail(user.email) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { userId?: string; role?: string; donationLink?: string }
    | null;

  if (!body?.userId || (!body.role && body.donationLink === undefined)) {
    return NextResponse.json(
      { error: "Missing userId or update data." },
      { status: 400 }
    );
  }

  if (body.role && body.role !== "tutor" && body.role !== "student") {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const updatePayload = body.role ? { role: body.role } : undefined;
  const updateResult = updatePayload
    ? await adminClient.auth.admin.updateUserById(body.userId, {
        user_metadata: updatePayload,
      })
    : { data: { user }, error: null };

  const updated = updateResult.data;
  const updateError = updateResult.error;

  if (updateError || !updated.user) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update user." },
      { status: 500 }
    );
  }

  if (body.donationLink !== undefined) {
    await adminClient
      .from("tutor_profiles")
      .upsert({
        user_id: body.userId,
        donation_link: body.donationLink,
        updated_at: new Date().toISOString(),
      });
  }

  const updatedUser = updated.user ?? user;
  const responseUser = {
    id: updatedUser.id,
    email: updatedUser.email,
    createdAt: updatedUser.created_at,
    lastSignInAt: updatedUser.last_sign_in_at,
    fullName: updatedUser.user_metadata?.full_name ?? "",
    role: resolveUserRole(
      updatedUser.email,
      updatedUser.user_metadata?.role ?? null
    ),
    donationLink: body.donationLink ?? "",
  };

  return NextResponse.json({ user: responseUser });
}

export async function DELETE(request: NextRequest) {
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

  if (resolveRoleByEmail(user.email) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { userId?: string }
    | null;

  if (!body?.userId) {
    return NextResponse.json({ error: "Missing userId." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    body.userId
  );

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to delete user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
