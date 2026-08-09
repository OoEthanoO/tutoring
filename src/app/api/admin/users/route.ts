import fs from "fs";
import path from "path";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isExecutive, isFounder, resolveUserRole, type UserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { fetchDiscordGuildMemberIds } from "@/lib/discordSync";
import { classEndMs } from "@/lib/classTiming";
import { sendDiscordMessageByChannelName } from "@/lib/notificationsServer";

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

type DiscordEmailRecipientMode = "blacklist" | "whitelist";

type DiscordEmailCandidate = {
  email?: string | null;
};

const normalizeEmailList = (items?: string[]) =>
  Array.isArray(items)
    ? Array.from(
      new Set(
        items
          .map((item) => normalizeEmail(String(item ?? "")))
          .filter(Boolean)
      )
    )
    : [];

const filterDiscordEmailTargets = <T extends DiscordEmailCandidate>(
  candidates: T[],
  recipientMode: DiscordEmailRecipientMode,
  emailSet: Set<string>
) => {
  const isListed = (item: T) =>
    emailSet.has(normalizeEmail(String(item.email ?? "")));

  if (recipientMode === "whitelist") {
    return {
      targets: candidates.filter(isListed),
      skippedUsers: candidates.filter((item) => !isListed(item)),
    };
  }

  return {
    targets: candidates.filter((item) => !isListed(item)),
    skippedUsers: candidates.filter(isListed),
  };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Resend allows at most 50 recipients (to + cc + bcc combined) per email.
const RESEND_MAX_RECIPIENTS = 50;

// Core sender with retry/backoff. Accepts an arbitrary Resend payload (to, bcc, etc.).
const postResendEmail = async (payload: Record<string, unknown>) => {
  if (!resendApiKey || !resendFrom) {
    return { ok: false as const, error: "Missing email configuration." };
  }

  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: resendFrom, ...payload }),
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
        ok: false as const,
        error: details || `Email provider error (${response.status}).`,
      };
    }

    const backoffMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds * 1000)
        : 500 * 2 ** (attempt - 1);

    await sleep(backoffMs);
  }

  return { ok: false as const, error: "Unknown email failure." };
};

const sendEmail = async (to: string, subject: string, html: string, attachments?: { filename: string; content: string }[]) => {
  if (!to) {
    return { ok: false as const, error: "Missing email configuration." };
  }
  return postResendEmail({
    to,
    subject,
    html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
};

// Send a single email to many recipients via BCC, chunked to respect Resend's
// per-message recipient limit. The visible "to" is the sender, so recipients
// cannot see each other.
const sendBccEmail = async (bccEmails: string[], subject: string, html: string) => {
  const recipients = Array.from(
    new Set(bccEmails.map((email) => normalizeEmail(email)).filter(Boolean))
  );

  // Leave one recipient slot for the "to" address (the sender).
  const chunkSize = RESEND_MAX_RECIPIENTS - 1;
  let sentCount = 0;
  const failed: Array<{ batch: string; error: string }> = [];

  for (let start = 0; start < recipients.length; start += chunkSize) {
    const chunk = recipients.slice(start, start + chunkSize);
    const result = await postResendEmail({
      to: resendFrom,
      bcc: chunk,
      subject,
      html,
    });

    if (result.ok) {
      sentCount += chunk.length;
    } else {
      failed.push({
        batch: `${start + 1}-${start + chunk.length}`,
        error: result.error ?? "Unknown email failure.",
      });
    }

    if (start + chunkSize < recipients.length) {
      await sleep(150);
    }
  }

  return { totalRecipients: recipients.length, sentCount, failed };
};

// A class is "upcoming" while it has not yet ended (start + duration > now).
const hasFutureClass = (
  classes: { starts_at: string; duration_hours: number | string | null }[] | null | undefined,
  nowMs: number
) =>
  (classes ?? []).some((cls) => {
    const startMs = new Date(cls.starts_at).getTime();
    if (Number.isNaN(startMs)) {
      return false;
    }
    const endMs = classEndMs(startMs, cls.duration_hours);
    return endMs > nowMs;
  });

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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Return distinct school names for autocomplete
  if (request.nextUrl.searchParams.get("schools") === "true") {
    const { data: schoolRows, error: schoolError } = await adminClient
      .from("app_users")
      .select("school")
      .not("school", "is", null)
      .neq("school", "");

    if (schoolError) {
      return NextResponse.json(
        { error: schoolError.message ?? "Failed to fetch schools." },
        { status: 500 }
      );
    }

    const uniqueSchools = Array.from(
      new Set((schoolRows ?? []).map((row) => (row.school as string).trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ schools: uniqueSchools });
  }

  const search = request.nextUrl.searchParams.get("email")?.toLowerCase() ?? "";
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const perPage = Math.min(
    200,
    Number(request.nextUrl.searchParams.get("perPage") ?? "200")
  );

  const wantUnverified = request.nextUrl.searchParams.get("unverified") === "true";
  const wantAll = request.nextUrl.searchParams.get("all") === "true";

  let query = adminClient
    .from("app_users")
    .select(
      "id, email, full_name, legal_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at, is_junior, grade, school, strike_count, custom_role, executive_generation"
    )
    .ilike("email", search ? `%${search}%` : "%")
    .order("created_at", { ascending: false });

  if (wantUnverified) {
    query = query.is("email_verified_at", null);
  } else if (!wantAll) {
    // default: only verified users
    query = query.not("email_verified_at", "is", null);
  }

  const { data, error: listError } = await query.range((page - 1) * perPage, page * perPage - 1);

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
    // null = membership unknown (Discord not configured / lookup failed)
    discordJoined: null as boolean | null,
    hasUpcomingClasses: false,
    isJunior: item.is_junior,
    grade: item.grade ?? "",
    school: item.school ?? "",
    strikeCount: item.strike_count || 0,
    legalName: item.legal_name ?? null,
    customRole: item.custom_role ?? null,
    generation: item.executive_generation ?? null,
    // true = receiving reminders, false = opted out, null = unknown.
    classReminderEmails: null as boolean | null,
  }));

  // Queried separately from the user list above so that a missing column (the
  // migration not yet applied) leaves this as "unknown" rather than failing the
  // whole admin user list. Covers every tutor rather than just this page, so the
  // caller can show a complete roster without paging through everyone.
  const remindersOffTutors: { id: string; fullName: string; email: string }[] = [];
  {
    const { data: optedOutRows } = await adminClient
      .from("app_users")
      .select("id, email, full_name, role, custom_role")
      .eq("class_reminder_emails", false);

    if (optedOutRows) {
      const optedOutIds = new Set(optedOutRows.map((row) => String(row.id)));
      users.forEach((user) => {
        user.classReminderEmails = !optedOutIds.has(String(user.id));
      });

      for (const row of optedOutRows) {
        const role = resolveUserRole(
          row.email,
          row.role ?? null,
          row.custom_role ? [String(row.custom_role)] : []
        );
        // Only tutors can opt out; ignore any stale row on a non-tutor.
        if (!isExecutive(role)) {
          continue;
        }
        remindersOffTutors.push({
          id: String(row.id),
          fullName: String(row.full_name ?? "").trim() || "Unnamed user",
          email: String(row.email ?? ""),
        });
      }
      remindersOffTutors.sort((left, right) => left.fullName.localeCompare(right.fullName));
    }
  }

  // For connected users, determine whether they have actually joined the Discord
  // server so the UI can distinguish "connected but not joined" from "connected
  // and joined". Skipped entirely when nobody on this page has connected Discord.
  if (users.some((user) => Boolean(user.discordUserId))) {
    const guildMemberIds = await fetchDiscordGuildMemberIds();
    if (guildMemberIds) {
      users.forEach((user) => {
        user.discordJoined = user.discordUserId
          ? guildMemberIds.has(user.discordUserId)
          : false;
      });
    }
  }

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

    // Determine which users on this page have an upcoming class, either as an
    // enrolled student or as the tutor who created the course. A class counts as
    // upcoming while it has not yet ended.
    const nowMs = Date.now();
    const upcomingUserIds = new Set<string>();

    const [{ data: enrollmentRows }, { data: tutorCourseRows }] = await Promise.all([
      adminClient
        .from("course_enrollments")
        .select("student_id, course:courses(deleted_at, course_classes(starts_at, duration_hours))")
        .in("student_id", userIds),
      adminClient
        .from("courses")
        .select("created_by, course_classes(starts_at, duration_hours)")
        .is("deleted_at", null)
        .in("created_by", userIds),
    ]);

    for (const row of enrollmentRows ?? []) {
      // Supabase types a to-one embed as an array; it is a single object at runtime.
      const course = row.course as unknown as
        | { deleted_at: string | null; course_classes: { starts_at: string; duration_hours: number | string | null }[] | null }
        | null;
      if (row.student_id && course && !course.deleted_at && hasFutureClass(course.course_classes, nowMs)) {
        upcomingUserIds.add(row.student_id);
      }
    }

    for (const row of tutorCourseRows ?? []) {
      if (row.created_by && hasFutureClass(row.course_classes, nowMs)) {
        upcomingUserIds.add(row.created_by);
      }
    }

    users.forEach((user) => {
      user.hasUpcomingClasses = upcomingUserIds.has(user.id);
    });
  }

  return NextResponse.json({ users, total: users.length, remindersOffTutors });
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
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
      isJunior?: boolean;
      grade?: string;
      school?: string;
      strikeCount?: number;
      transferDiscordFromEmail?: string;
      customRole?: string | null;
      generation?: string | null;
    }
    | null;

  if (
    !body?.userId ||
    (!body.role &&
      body.donationLink === undefined &&
      body.tutorPromotedAt === undefined &&
      body.isJunior === undefined &&
      body.grade === undefined &&
      body.school === undefined &&
      body.strikeCount === undefined &&
      body.customRole === undefined &&
      body.generation === undefined &&
      body.transferDiscordFromEmail === undefined)
  ) {
    return NextResponse.json(
      { error: "Missing userId or update data." },
      { status: 400 }
    );
  }

  if (body.role && !isExecutive(body.role as UserRole) && body.role !== "tutor" && body.role !== "student") {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (body.transferDiscordFromEmail) {
    const emailToSearch = normalizeEmail(body.transferDiscordFromEmail);
    const { data: sourceUser, error: sourceError } = await adminClient
      .from("app_users")
      .select("id, discord_user_id, discord_username, discord_connected_at")
      .ilike("email", emailToSearch)
      .single();

    if (sourceError || !sourceUser) {
      return NextResponse.json({ error: "Source user not found." }, { status: 404 });
    }

    if (!sourceUser.discord_user_id) {
      return NextResponse.json({ error: "Source user does not have a Discord connection." }, { status: 400 });
    }

    if (sourceUser.id === body.userId) {
      return NextResponse.json({ error: "Cannot transfer from the same user." }, { status: 400 });
    }

    const { error: unlinkError } = await adminClient
      .from("app_users")
      .update({
        discord_user_id: null,
        discord_username: null,
        discord_connected_at: null,
      })
      .eq("id", sourceUser.id);

    if (unlinkError) {
      return NextResponse.json({ error: "Failed to unlink Discord from source user." }, { status: 500 });
    }

    const { data: updatedTarget, error: linkError } = await adminClient
      .from("app_users")
      .update({
        discord_user_id: sourceUser.discord_user_id,
        discord_username: sourceUser.discord_username,
        discord_connected_at: sourceUser.discord_connected_at,
      })
      .eq("id", body.userId)
      .select("id, email, full_name, legal_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at, is_junior, grade, school, strike_count, custom_role, executive_generation")
      .single();

    if (linkError || !updatedTarget) {
      return NextResponse.json({ error: "Failed to link Discord to target user." }, { status: 500 });
    }

    let discordJoined: boolean | null = null;
    if (updatedTarget.discord_user_id) {
      const guildMemberIds = await fetchDiscordGuildMemberIds();
      if (guildMemberIds) {
        discordJoined = guildMemberIds.has(updatedTarget.discord_user_id);
      }
    } else {
      discordJoined = false;
    }

    const responseUser = {
      id: updatedTarget.id,
      email: updatedTarget.email,
      createdAt: updatedTarget.created_at,
      lastSignInAt: null,
      fullName: updatedTarget.full_name ?? "",
      role: resolveUserRole(updatedTarget.email, updatedTarget.role ?? null),
      donationLink: "", // We don't fetch it here, UI will preserve existing state if we just return what we have or we can ignore it
      tutorPromotedAt: updatedTarget.tutor_promoted_at ?? null,
      discordUserId: updatedTarget.discord_user_id ?? null,
      discordUsername: updatedTarget.discord_username ?? null,
      discordJoined,
      discordConnectedAt: updatedTarget.discord_connected_at ?? null,
      isJunior: updatedTarget.is_junior ?? false,
      grade: updatedTarget.grade ?? "",
      school: updatedTarget.school ?? "",
      strikeCount: updatedTarget.strike_count || 0,
      legalName: updatedTarget.legal_name ?? null,
      customRole: updatedTarget.custom_role ?? null,
      generation: updatedTarget.executive_generation ?? null,
    };

    return NextResponse.json({ user: responseUser });
  }

  const existingUser = body.role !== undefined || body.tutorPromotedAt !== undefined || body.isJunior !== undefined || body.strikeCount !== undefined
    ? await adminClient
      .from("app_users")
      .select("id, email, role, is_junior, strike_count, custom_role")
      .eq("id", body.userId)
      .single()
    : null;

  if ((body.role !== undefined || body.tutorPromotedAt !== undefined) && (existingUser?.error || !existingUser?.data)) {
    return NextResponse.json(
      { error: existingUser?.error?.message ?? "Failed to load user." },
      { status: 500 }
    );
  }

  const existingRole: string | null = existingUser?.data?.role ?? null;
  const isPromotingToTutor =
    isExecutive(body.role as UserRole) && !isExecutive(existingRole as UserRole | null) && existingRole !== "tutor";

  const isDemotingFromTutor =
    body.role === "student" && (existingRole === "tutor" || isExecutive(existingRole as UserRole | null));

  const shouldUpdatePromotedAt = body.tutorPromotedAt !== undefined;
  const normalizedPromotedAt =
    body.tutorPromotedAt === null ? null : body.tutorPromotedAt;

  const updatePayload =
    body.role || shouldUpdatePromotedAt || body.isJunior !== undefined || body.grade !== undefined || body.school !== undefined || body.strikeCount !== undefined || body.customRole !== undefined || body.generation !== undefined
      ? {
        role: body.role !== undefined ? (isExecutive(body.role as UserRole) ? "tutor" : body.role) : undefined,
        tutor_promoted_at: isPromotingToTutor
          ? new Date().toISOString()
          : shouldUpdatePromotedAt
            ? normalizedPromotedAt
            : undefined,
        is_junior: body.isJunior !== undefined ? body.isJunior : undefined,
        grade: body.grade !== undefined ? body.grade : undefined,
        school: body.school !== undefined ? body.school : undefined,
        strike_count: body.strikeCount !== undefined ? body.strikeCount : undefined,
        last_strike_at: body.strikeCount === 0 ? null : (body.strikeCount !== undefined && body.strikeCount > 0 ? new Date().toISOString() : undefined),
        custom_role: body.customRole !== undefined ? body.customRole : undefined,
        executive_generation: body.generation !== undefined ? body.generation : undefined,
      }
      : null;
  const updateResult = updatePayload
    ? await adminClient
      .from("app_users")
      .update(updatePayload)
      .eq("id", body.userId)
      .select(
        "id, email, full_name, legal_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at, is_junior, grade, school, strike_count, custom_role, executive_generation"
      )
      .single()
    : await adminClient
      .from("app_users")
      .select(
        "id, email, full_name, legal_name, role, created_at, tutor_promoted_at, discord_user_id, discord_username, discord_connected_at, is_junior, grade, school, strike_count, custom_role, executive_generation"
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

  // A strike is a warning, so the person warned has to hear about it. Only on an
  // increase: clearing or lowering a strike is not something to ping anyone for.
  if (body.strikeCount !== undefined) {
    const previousStrikeCount = Number(existingUser?.data?.strike_count ?? 0);
    const newStrikeCount = Number(updated.strike_count ?? 0);
    if (newStrikeCount > previousStrikeCount) {
      const executivesChannelName =
        String(process.env.DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME ?? "").trim() || "executives";
      const targetDiscordId = String(updated.discord_user_id ?? "").trim();
      // Without a linked Discord account there is nobody to mention, so name
      // them instead — the strike still has to be visible to the executives.
      const who = targetDiscordId
        ? `<@${targetDiscordId}>`
        : `**${updated.full_name || updated.email || "A tutor"}**`;
      const strikeWord = newStrikeCount === 1 ? "strike" : "strikes";
      const content = [
        `${who} You have been given a strike. You now have **${newStrikeCount} ${strikeWord}**.`,
        "Strikes come from missing classes, joining late, or leaving before the last 5 minutes of class.",
        "**Two strikes means permanent removal from the organization.** If you believe this is a mistake, contact a founder.",
      ].join("\n");

      // Best-effort: a Discord outage must not fail the strike itself, which is
      // already saved.
      try {
        await sendDiscordMessageByChannelName(
          executivesChannelName,
          content,
          undefined,
          targetDiscordId ? [targetDiscordId] : undefined
        );
      } catch (error) {
        console.error("Failed to send strike warning to Discord", error);
      }
    }
  }

  if (isDemotingFromTutor) {
    await adminClient
      .from("courses")
      .update({
        created_by: null,
        created_by_name: null,
        created_by_email: null,
      })
      .eq("created_by", body.userId);
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
    const attachments: { filename: string; content: string }[] = [];
    try {
      const imagePath = path.join(process.cwd(), "public", "Waterloo Tutor Application Form.png");
      if (fs.existsSync(imagePath)) {
        const content = fs.readFileSync(imagePath).toString("base64");
        attachments.push({
          filename: "Waterloo Tutor Application Form.png",
          content,
        });
      }
    } catch (e) {
      console.error("Failed to read tutor application form image", e);
    }

    const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const formUrl = siteBase ? `${siteBase}/redirect/tutor-form` : "https://forms.gle/gmiLF8fDffTXn5sT6";

    await sendEmail(
      updated.email,
      "You've been promoted to Executive!",
      `<p>Congratulations! You have been promoted to an executive.</p><p>If you are applying as a tutor role, please fill out the following tutor application form: <br/><a href="${formUrl}">${formUrl}</a></p><p>Please see the attached image as a guide for how to fill out the form.</p>`,
      attachments.length > 0 ? attachments : undefined
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
    isJunior: updatedUser.is_junior ?? false,
    grade: updatedUser.grade ?? "",
    school: updatedUser.school ?? "",
    strikeCount: updatedUser.strike_count || 0,
    legalName: updatedUser.legal_name ?? null,
    customRole: updatedUser.custom_role ?? null,
    generation: updatedUser.executive_generation ?? null,
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
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
    | {
      action?: string;
      recipientMode?: string;
      emails?: string[];
      skipEmails?: string[];
    }
    | null;

  if (
    body?.action &&
    body.action !== "notify_discord_unlinked" &&
    body.action !== "notify_discord_transition" &&
    body.action !== "notify_unjoined_students_with_classes"
  ) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  if (
    body?.recipientMode &&
    body.recipientMode !== "blacklist" &&
    body.recipientMode !== "whitelist"
  ) {
    return NextResponse.json({ error: "Invalid recipient mode." }, { status: 400 });
  }

  const recipientMode: DiscordEmailRecipientMode =
    body?.recipientMode === "whitelist" ? "whitelist" : "blacklist";
  const recipientEmails = normalizeEmailList(
    Array.isArray(body?.emails) ? body.emails : body?.skipEmails
  );
  const recipientEmailSet = new Set(recipientEmails);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: users, error: listError } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role, discord_user_id")
    .not("email_verified_at", "is", null);

  if (listError || !users) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to fetch users." },
      { status: 500 }
    );
  }

  if (body?.action === "notify_unjoined_students_with_classes") {
    // Determine which courses have an upcoming class, then which students are
    // enrolled in them.
    const nowMs = Date.now();
    const { data: courseRows, error: courseError } = await adminClient
      .from("courses")
      .select("id, course_classes(starts_at, duration_hours)")
      .is("deleted_at", null);

    if (courseError) {
      return NextResponse.json(
        { error: courseError.message ?? "Failed to fetch courses." },
        { status: 500 }
      );
    }

    const upcomingCourseIds = (courseRows ?? [])
      .filter((course) =>
        hasFutureClass(
          (course as { course_classes: { starts_at: string; duration_hours: number | string | null }[] | null }).course_classes,
          nowMs
        )
      )
      .map((course) => course.id);

    const studentIdsWithUpcoming = new Set<string>();
    if (upcomingCourseIds.length > 0) {
      const { data: enrollmentRows } = await adminClient
        .from("course_enrollments")
        .select("student_id")
        .in("course_id", upcomingCourseIds);
      for (const row of enrollmentRows ?? []) {
        if (row.student_id) {
          studentIdsWithUpcoming.add(row.student_id);
        }
      }
    }

    // Determine Discord server membership. When this is unavailable we cannot
    // confirm a connected user has NOT joined, so we only target the clearly
    // unconnected ones to avoid emailing people who are already fully set up.
    const guildMemberIds = await fetchDiscordGuildMemberIds();

    const candidates = users.filter((item) => {
      const email = normalizeEmail(String(item.email ?? ""));
      if (!email) {
        return false;
      }
      const role = resolveUserRole(email, item.role ?? null);
      if (role !== "student") {
        return false;
      }
      if (!studentIdsWithUpcoming.has(item.id)) {
        return false;
      }

      const discordUserId = (item.discord_user_id ?? "").trim();
      const notConnected = !discordUserId;
      const connectedButNotJoined =
        Boolean(discordUserId) && guildMemberIds !== null && !guildMemberIds.has(discordUserId);
      return notConnected || connectedButNotJoined;
    });

    const { targets, skippedUsers } = filterDiscordEmailTargets(
      candidates,
      recipientMode,
      recipientEmailSet
    );

    const subject = "Action required: connect & join Discord to attend your classes";
    const html = `<p>Hi there,</p>
<p>Our records show you have upcoming classes but have <strong>not yet finished setting up Discord</strong>. Classes are held in our Discord server, so you must complete <strong>both</strong> of the following to attend:</p>
<ol>
  <li><strong>Connect your Discord account</strong> to your YanLearn profile.</li>
  <li><strong>Join the YanLearn Discord server.</strong></li>
</ol>
<p>To do this:</p>
<ol>
  <li>Sign in to your YanLearn account.</li>
  <li>Click your profile card in the top-right corner.</li>
  <li>Click <strong>Connect Discord</strong> and authorize your Discord account.</li>
  <li>After authorizing, you will be redirected to the server invite page — accept it to join.</li>
</ol>
<p>If you connected Discord but closed that tab before joining, open your profile card and click <strong>Join Discord Server</strong> to retry.</p>
<p><strong>Please complete both steps before your next class</strong>, otherwise you will not be able to attend.</p>
<p>Thanks,<br/>The YanLearn Team</p>`;

    const targetEmails = targets
      .map((item) => normalizeEmail(String(item.email ?? "")))
      .filter(Boolean);

    const { totalRecipients, sentCount, failed } = await sendBccEmail(
      targetEmails,
      subject,
      html
    );

    return NextResponse.json({
      targetCount: totalRecipients,
      sentCount,
      failedCount: failed.length,
      recipientMode,
      skippedCount: skippedUsers.length,
      skippedEmails: skippedUsers
        .map((item) => normalizeEmail(String(item.email ?? "")))
        .filter(Boolean),
      membershipKnown: guildMemberIds !== null,
      failed,
    });
  }

  if (body?.action === "notify_discord_transition") {
    const studentUsers = users.filter((item) => {
      const email = normalizeEmail(String(item.email ?? ""));
      const role = resolveUserRole(email, item.role ?? null);
      return Boolean(email) && role === "student";
    });

    const { targets, skippedUsers } = filterDiscordEmailTargets(
      studentUsers,
      recipientMode,
      recipientEmailSet
    );

    const subject = "Important Update: Classes are moving to Discord!";
    const failed: Array<{ email: string; error: string }> = [];
    let sentCount = 0;

    for (const [index, target] of targets.entries()) {
      const email = normalizeEmail(String(target.email ?? ""));
      if (!email) continue;

      const recipientName = escapeHtml((target.full_name ?? "").trim() || "there");
      const emailResult = await sendEmail(
        email,
        subject,
        `<p>Hi ${recipientName},</p>
<p>We have an important update regarding how classes will be hosted! Going forward, our classes will be transitioning from Zoom to Discord.</p>
<p><strong>How it works:</strong></p>
<ul>
  <li>You will need to connect your Discord account to your YanLearn profile and join our Discord server.</li>
  <li>Notifications and links to voice channels for your classes will be sent directly within our Discord server.</li>
</ul>
<p><em>Note: Courses taught by our lead tutor, Yan Xu, will continue to use Schoolhouse, which relies on Zoom.</em></p>
<p>Please let us know if you have any questions!</p>
<p>Thanks,<br/>The YanLearn Team</p>`
      );

      if (!emailResult.ok) {
        failed.push({
          email,
          error: emailResult.error ?? "Unknown email failure.",
        });
      } else {
        sentCount += 1;
      }

      if (index < targets.length - 1) {
        await sleep(150);
      }
    }

    return NextResponse.json({
      targetCount: targets.length,
      sentCount,
      failedCount: failed.length,
      recipientMode,
      skippedCount: skippedUsers.length,
      skippedEmails: skippedUsers
        .map((item) => normalizeEmail(String(item.email ?? "")))
        .filter(Boolean),
      failed,
    });
  }

  // Handle notify_discord_unlinked
  const unlinkedUsers = users.filter((item) => {
    const email = normalizeEmail(String(item.email ?? ""));
    const discordUserId = (item.discord_user_id ?? "").trim();
    return Boolean(email) && !discordUserId;
  });
  const { targets, skippedUsers } = filterDiscordEmailTargets(
    unlinkedUsers,
    recipientMode,
    recipientEmailSet
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
<p><strong>Connecting Discord and joining the Discord server is crucial for lessons.</strong> Class reminders and voice channel links are sent through the Discord server, so please complete both steps before your next lesson.</p>
<p>To join, please follow these steps:</p>
<ol>
  <li>Sign in to your YanLearn account.</li>
  <li>Click your profile card in the top-right corner.</li>
  <li>Click <strong>Connect Discord</strong> and authorize your Discord account.</li>
  <li>After authorization, you will be redirected directly to the Discord server invite page to join.</li>
</ol>
<p>If you authorized Discord but closed that tab before joining, open your profile card and click <strong>Join Discord Server</strong> to retry.</p>
<p>This keeps server access limited to verified YanLearn users.</p>
<p>Thanks,<br/>Yan Xu</p>`
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
    recipientMode,
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

  if (!isFounder(resolveUserRole(user.email, user.role ?? null))) {
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

  // Make user's courses into limbo courses before deleting the user
  await adminClient
    .from("courses")
    .update({
      created_by: null,
      created_by_name: null,
      created_by_email: null,
    })
    .eq("created_by", body.userId);

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
