import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isExecutive, resolveUserRole } from "@/lib/roles";
import {
  ensureTutorWithdrawalRequestsSchema,
  getTutorAvailability,
} from "@/lib/withdrawalRequests";
import {
  getDiscordRoleIdByName,
  sendDiscordMessageByChannelName,
} from "@/lib/notificationsServer";
import { classCountForHours, describeHourSteps } from "@/lib/serviceHours";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const requestFields = "id, hours, status, created_at, resolved_at";

/**
 * Tutor-facing hour withdrawal requests. Tutors request; the COO fulfills or
 * declines via the admin "Withdraw hours" dashboard. Submitting posts a Discord
 * message to the founders channel mentioning @COO.
 */
export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles
        .map((r: { role_level?: string }) => r.role_level)
        .filter((level): level is string => Boolean(level))
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isExecutive(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  await ensureTutorWithdrawalRequestsSchema(adminClient);

  const [
    { availableHours, withdrawnHours, hourSteps },
    { data: selfRow },
    { data: requests },
    { data: withdrawals },
  ] = await Promise.all([
    getTutorAvailability(adminClient, user.id),
    adminClient.from("app_users").select("legal_name, grade").eq("id", user.id).single(),
    adminClient
      .from("tutor_withdrawal_requests")
      .select(requestFields)
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    adminClient
      .from("tutor_withdrawals")
      .select("id, hours, start_date, end_date, created_at")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    availableHours,
    withdrawnHours,
    // Valid request amounts: classes are withdrawn oldest-first and are worth
    // 1.5 or 2 hours depending on the course's grade level.
    hourSteps,
    legalNameSet: Boolean(String(selfRow?.legal_name ?? "").trim()),
    gradeSet: /^(9|10|11|12)$/.test(String(selfRow?.grade ?? "").trim()),
    requests: requests ?? [],
    withdrawals: withdrawals ?? [],
  });
}

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles
        .map((r: { role_level?: string }) => r.role_level)
        .filter((level): level is string => Boolean(level))
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isExecutive(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const hours = body?.hours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ error: "Hours must be a positive number." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  await ensureTutorWithdrawalRequestsSchema(adminClient);

  // Legal name is required for community-service-hour records.
  const { data: selfRow } = await adminClient
    .from("app_users")
    .select("full_name, legal_name, email, grade")
    .eq("id", user.id)
    .single();

  const legalName = String(selfRow?.legal_name ?? "").trim();
  if (!legalName) {
    return NextResponse.json(
      {
        error: "You must set your legal name before requesting an hour withdrawal.",
        code: "missing_legal_name",
      },
      { status: 400 }
    );
  }

  // Grade appears on the community-service form (Grade 9-12 checkboxes).
  const grade = String(selfRow?.grade ?? "").trim();
  if (!/^(9|10|11|12)$/.test(grade)) {
    return NextResponse.json(
      {
        error:
          "You must set your current grade (9–12) before requesting an hour withdrawal — it appears on the community service form.",
        code: "missing_grade",
      },
      { status: 400 }
    );
  }

  const { availableHours, availableClassHours } = await getTutorAvailability(
    adminClient,
    user.id
  );
  if (hours > availableHours) {
    return NextResponse.json(
      {
        error: `You only have ${availableHours} withdrawable hours available, which is less than the requested ${hours} hours.`,
      },
      { status: 400 }
    );
  }

  // Classes are withdrawn oldest-first at 1.5 or 2 hours each (grade 11/12
  // courses earn 2), so the amount has to land on a class boundary.
  const requestedClassCount = classCountForHours(availableClassHours, hours);
  if (requestedClassCount === null) {
    return NextResponse.json(
      {
        error: `${hours} hours does not match a whole number of classes. Valid amounts: ${describeHourSteps(availableClassHours)}.`,
      },
      { status: 400 }
    );
  }

  // Only one pending request at a time.
  const { data: existingPending } = await adminClient
    .from("tutor_withdrawal_requests")
    .select("id")
    .eq("tutor_id", user.id)
    .eq("status", "pending")
    .limit(1);

  if ((existingPending ?? []).length > 0) {
    return NextResponse.json(
      {
        error: "You already have a pending withdrawal request.",
        code: "pending_request_exists",
      },
      { status: 400 }
    );
  }

  const { data: created, error: insertError } = await adminClient
    .from("tutor_withdrawal_requests")
    .insert({
      tutor_id: user.id,
      tutor_legal_name: legalName,
      hours,
      status: "pending",
    })
    .select(requestFields)
    .single();

  if (insertError || !created) {
    // Unique-violation on the one-pending partial index: a concurrent submit won.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      return NextResponse.json(
        {
          error: "You already have a pending withdrawal request.",
          code: "pending_request_exists",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create withdrawal request." },
      { status: 500 }
    );
  }

  // Notify the COO in the founders channel. Best-effort: a Discord failure must
  // not fail the request itself.
  let discordNotified = false;
  try {
    const cooRoleId = await getDiscordRoleIdByName("COO");
    const fullName = String(selfRow?.full_name ?? "").trim() || "Unknown tutor";
    const email = String(selfRow?.email ?? user.email ?? "").trim();
    const mentionLine = cooRoleId
      ? `<@&${cooRoleId}> New hour withdrawal request`
      : `@COO — New hour withdrawal request`;
    const content = [
      mentionLine,
      "",
      `**Tutor:** ${fullName}${email ? ` (${email})` : ""}`,
      `**Legal name:** ${legalName}`,
      `**Requested:** ${hours} hours (${requestedClassCount} lesson${requestedClassCount !== 1 ? "s" : ""})`,
      `**Available balance:** ${availableHours} hours`,
      "",
      `Fulfill or decline it in the dashboard under "Withdraw hours".`,
    ].join("\n");

    discordNotified = await sendDiscordMessageByChannelName(
      "founders",
      content,
      cooRoleId ? [cooRoleId] : undefined
    );
  } catch (error) {
    console.error("Failed to send withdrawal-request Discord notification:", error);
  }

  return NextResponse.json({ success: true, request: created, discordNotified });
}
