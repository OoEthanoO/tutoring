import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

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

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
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

  const { data, error: listError } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role, created_at, tutor_promoted_at")
    .ilike("email", search ? `%${search}%` : "%")
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to fetch users." },
      { status: 500 }
    );
  }

  const users = data.map((item) => ({
    id: item.id,
    email: item.email,
    createdAt: item.created_at,
    lastSignInAt: null,
    fullName: item.full_name ?? "",
    role: resolveUserRole(item.email, item.role ?? null),
    donationLink: "",
    tutorPromotedAt: item.tutor_promoted_at ?? null,
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

  return NextResponse.json({ users, total: users.length });
}

export async function PATCH(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        userId?: string;
        role?: string;
        donationLink?: string;
        tutorPromotedAt?: string | null;
      }
    | null;

  if (
    !body?.userId ||
    (!body.role &&
      body.donationLink === undefined &&
      body.tutorPromotedAt === undefined)
  ) {
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

  const existingUser = body.role !== undefined || body.tutorPromotedAt !== undefined
    ? await adminClient
        .from("app_users")
        .select("id, email, role")
        .eq("id", body.userId)
        .single()
    : null;

  if ((body.role !== undefined || body.tutorPromotedAt !== undefined) && (existingUser?.error || !existingUser?.data)) {
    return NextResponse.json(
      { error: existingUser?.error?.message ?? "Failed to load user." },
      { status: 500 }
    );
  }

  const existingRole = existingUser?.data?.role ?? null;
  const isPromotingToTutor =
    body.role === "tutor" && existingRole !== "tutor";

  const shouldUpdatePromotedAt = body.tutorPromotedAt !== undefined;
  const normalizedPromotedAt =
    body.tutorPromotedAt === null ? null : body.tutorPromotedAt;

  const updatePayload =
    body.role || shouldUpdatePromotedAt
      ? {
          role: body.role ?? existingRole ?? "student",
          tutor_promoted_at: isPromotingToTutor
            ? new Date().toISOString()
            : shouldUpdatePromotedAt
              ? normalizedPromotedAt
              : undefined,
        }
      : null;
  const updateResult = updatePayload
    ? await adminClient
        .from("app_users")
        .update(updatePayload)
        .eq("id", body.userId)
        .select("id, email, full_name, role, created_at, tutor_promoted_at")
        .single()
    : await adminClient
        .from("app_users")
        .select("id, email, full_name, role, created_at, tutor_promoted_at")
        .eq("id", body.userId)
        .single();

  const updated = updateResult.data;
  const updateError = updateResult.error;

  if (updateError || !updated) {
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

  const updatedUser = updated;
  const responseUser = {
    id: updatedUser.id,
    email: updatedUser.email,
    createdAt: updatedUser.created_at,
    lastSignInAt: null,
    fullName: updatedUser.full_name ?? "",
    role: resolveUserRole(
      updatedUser.email,
      updatedUser.role ?? null
    ),
    donationLink: body.donationLink ?? "",
    tutorPromotedAt: updatedUser.tutor_promoted_at ?? null,
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

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
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

  const { error: deleteError } = await adminClient
    .from("app_users")
    .delete()
    .eq("id", body.userId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to delete user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
