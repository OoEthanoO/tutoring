import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { fetchDiscordGuildMemberIds } from "@/lib/discordSync";
import { isExecutive, isFounder, resolveUserRole, resolveAccountRole, canManageAccountAccess } from "@/lib/roles";
import { checkLeadershipProtection } from "@/lib/accountProtection";

const discordUserIdPattern = /^\d{17,20}$/;

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const adminClient = getAdminClient();

  // Verified executive-tier users double as both the owner lookup for the list
  // and the tutor options for the "approve" form. The guild member list powers
  // the "in server" status (null when Discord is not configured); a short cache
  // window keeps panel reloads from re-walking the whole guild.
  const [{ data: accounts, error }, { data: userRows }, guildMemberIds] =
    await Promise.all([
      adminClient
        .from("approved_discord_accounts")
        .select("discord_user_id, owner_user_id, label, created_at")
        .order("created_at", { ascending: false }),
      adminClient
        .from("app_users")
        .select("id, full_name, email, role, custom_role, custom_roles(role_level)")
        .not("email_verified_at", "is", null)
        .order("full_name", { ascending: true }),
      fetchDiscordGuildMemberIds({ maxAgeMs: 30_000 }),
    ]);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch approved Discord accounts." },
      { status: 500 }
    );
  }

  const userById = new Map<string, { full_name: string | null; email: string | null; canManage: boolean }>();
  const tutors: { id: string; name: string; email: string }[] = [];
  for (const user of userRows ?? []) {
    userById.set(String(user.id), {
      full_name: user.full_name ?? null,
      email: user.email ?? null,
      canManage: canManageAccountAccess(resolveAccountRole(actor), resolveAccountRole(user)),
    });
    if (isExecutive(resolveAccountRole(user)) && canManageAccountAccess(resolveAccountRole(actor), resolveAccountRole(user))) {
      tutors.push({
        id: String(user.id),
        name: String(user.full_name ?? "").trim(),
        email: String(user.email ?? "").trim(),
      });
    }
  }

  return NextResponse.json({
    approvedAccounts: (accounts ?? []).map((account) => {
      const owner = userById.get(String(account.owner_user_id ?? "").trim()) ?? null;
      return {
        discord_user_id: account.discord_user_id,
        label: account.label ?? null,
        created_at: account.created_at,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
        canManage: owner?.canManage ?? false,
        // true/false when the guild lookup succeeded, null when unknown.
        in_server: guildMemberIds
          ? guildMemberIds.has(String(account.discord_user_id))
          : null,
      };
    }),
    tutors,
  });
}

export async function POST(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const discordUserId = String(body?.discordUserId ?? "").trim();
  const label = String(body?.label ?? "").trim();
  const ownerUserId = String(body?.ownerUserId ?? "").trim();

  if (!discordUserIdPattern.test(discordUserId)) {
    return NextResponse.json(
      { error: "Discord user ID must be a 17-20 digit number." },
      { status: 400 }
    );
  }

  if (!ownerUserId) {
    return NextResponse.json(
      { error: "An associated tutor is required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();

  const ownerProtection = await checkLeadershipProtection(adminClient, actor, { id: ownerUserId });
  if (ownerProtection) return NextResponse.json({ error: ownerProtection.error }, { status: ownerProtection.status });

  const [{ data: owner, error: ownerError }, { data: linkedUsers, error: linkedError }] = await Promise.all([
    adminClient.from("app_users").select("id").eq("id", ownerUserId).maybeSingle(),
    // A Discord ID already linked to a website account is managed through that
    // account; approving it here is almost certainly a mistyped ID.
    adminClient
      .from("app_users")
      .select("email")
      .eq("discord_user_id", discordUserId)
      .limit(1),
  ]);

  if (ownerError || linkedError) {
    return NextResponse.json({ error: "Could not verify the Discord account's ownership." }, { status: 503 });
  }

  if (!owner) {
    return NextResponse.json(
      { error: "The selected tutor account was not found." },
      { status: 400 }
    );
  }

  const linkedUser = linkedUsers?.[0] ?? null;
  if (linkedUser) {
    return NextResponse.json(
      {
        error: `This Discord account is already linked to the website account ${
          linkedUser.email ?? "(unknown email)"
        }. Approval is only for extra accounts without a website login.`,
      },
      { status: 400 }
    );
  }

  const { error } = await adminClient.from("approved_discord_accounts").insert({
    discord_user_id: discordUserId,
    owner_user_id: ownerUserId,
    label: label || null,
  });

  if (error) {
    // 23505 is unique violation
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This Discord account is already approved." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Failed to approve Discord account: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, discordUserId });
}

export async function DELETE(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || !isFounder(resolveUserRole(actor.email, actor.role ?? null))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const discordUserId = String(body?.discordUserId ?? "").trim();

  if (!discordUserId) {
    return NextResponse.json(
      { error: "Discord user ID is required." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();
  const { data: account, error: accountError } = await adminClient.from("approved_discord_accounts")
    .select("owner_user_id").eq("discord_user_id", discordUserId).maybeSingle();
  if (accountError) return NextResponse.json({ error: "Could not verify the account owner." }, { status: 503 });
  if (account?.owner_user_id) {
    const protection = await checkLeadershipProtection(adminClient, actor, { id: account.owner_user_id });
    if (protection) return NextResponse.json({ error: protection.error }, { status: protection.status });
  }
  const { error } = await adminClient
    .from("approved_discord_accounts")
    .delete()
    .eq("discord_user_id", discordUserId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to remove approved Discord account." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, discordUserId });
}
