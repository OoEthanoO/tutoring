import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!resendApiKey || !resendFrom || !to) {
    return { ok: false, error: "Missing email configuration." };
  }

  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to,
        subject,
        html,
      }),
    });

    if (response.ok) {
      return { ok: true as const };
    }

    const details = (await response.text().catch(() => "")).trim();
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseFloat(retryAfterHeader)
      : Number.NaN;
    const isRetriable = response.status === 429 || response.status >= 500;

    if (!isRetriable || attempt === maxAttempts) {
      return {
        ok: false,
        error: details || `Email provider error (${response.status}).`,
      };
    }

    const backoffMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds * 1000)
        : 500 * 2 ** (attempt - 1);

    await sleep(backoffMs);
  }

  return { ok: false, error: "Unknown email failure." };
};

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
    .select(
      "id, email, full_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at"
    )
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
    discordUserId: item.discord_user_id ?? null,
    discordUsername: item.discord_username ?? null,
    discordConnectedAt: item.discord_connected_at ?? null,
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
      .select(
        "id, email, full_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at"
      )
      .single()
    : await adminClient
      .from("app_users")
      .select(
        "id, email, full_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at"
      )
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

  if (isPromotingToTutor && updated.email) {
    const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSeuaZhER3fUbkl1ijHy0k-COLAcpOy8QvYM5sgtcWGEqtHmNw/viewform";
    await sendEmail(
      updated.email,
      "You've been promoted to Tutor!",
      `<p>Congratulations! You have been promoted to a tutor.</p><p>Please fill out the tutor application form here: <a href="${formUrl}">${formUrl}</a></p>`
    );
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
    discordUserId: updatedUser.discord_user_id ?? null,
    discordUsername: updatedUser.discord_username ?? null,
    discordConnectedAt: updatedUser.discord_connected_at ?? null,
  };

  return NextResponse.json({ user: responseUser });
}

export async function POST(request: NextRequest) {
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

  if (!resendApiKey || !resendFrom) {
    return NextResponse.json(
      {
        error:
          "Missing RESEND_API_KEY or RESEND_FROM. Cannot send notification emails.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; skipEmails?: string[] }
    | null;

  if (body?.action && body.action !== "notify_discord_unlinked") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const skipEmails = Array.isArray(body?.skipEmails)
    ? Array.from(
      new Set(
        body!.skipEmails
          .map((item) => normalizeEmail(String(item ?? "")))
          .filter(Boolean)
      )
    )
    : [];
  const skipEmailSet = new Set(skipEmails);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: users, error: listError } = await adminClient
    .from("app_users")
    .select("id, email, full_name, discord_user_id");

  if (listError || !users) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to fetch users." },
      { status: 500 }
    );
  }

  const unlinkedUsers = users.filter((item) => {
    const email = normalizeEmail(String(item.email ?? ""));
    const discordUserId = (item.discord_user_id ?? "").trim();
    return Boolean(email) && !discordUserId;
  });
  const skippedUsers = unlinkedUsers.filter((item) =>
    skipEmailSet.has(normalizeEmail(String(item.email ?? "")))
  );
  const targets = unlinkedUsers.filter(
    (item) => !skipEmailSet.has(normalizeEmail(String(item.email ?? "")))
  );

  const subject = "YanLearn Discord server is now live";
  const failed: Array<{ email: string; error: string }> = [];
  let sentCount = 0;

  for (const [index, target] of targets.entries()) {
    const email = normalizeEmail(String(target.email ?? ""));
    if (!email) {
      continue;
    }

    const recipientName = escapeHtml((target.full_name ?? "").trim() || "there");
    const emailResult = await sendEmail(
      email,
      subject,
      `<p>Hi ${recipientName},</p>
<p>We have just launched the YanLearn Discord server.</p>
<p>To join, please follow these steps:</p>
<ol>
  <li>Sign in to your YanLearn account.</li>
  <li>Click your profile card in the top-right corner.</li>
  <li>Click <strong>Connect Discord</strong> and authorize your Discord account.</li>
  <li>Click <strong>Join Discord Server</strong>.</li>
</ol>
<p>This keeps server access limited to verified YanLearn users.</p>
<p>Thanks,<br/>Ethan Yan Xu</p>`
    );

    if (!emailResult.ok) {
      failed.push({
        email,
        error: emailResult.error ?? "Unknown email failure.",
      });
    } else {
      sentCount += 1;
    }

    // Pace requests to reduce provider throttling on larger batches.
    if (index < targets.length - 1) {
      await sleep(150);
    }
  }

  return NextResponse.json({
    targetCount: targets.length,
    sentCount,
    failedCount: failed.length,
    skippedCount: skippedUsers.length,
    skippedEmails: skippedUsers
      .map((item) => normalizeEmail(String(item.email ?? "")))
      .filter(Boolean),
    failed,
  });
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
