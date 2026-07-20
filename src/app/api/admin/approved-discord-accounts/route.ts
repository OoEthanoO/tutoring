import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";

const discordUserIdPattern = /^\d{17,20}$/;

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || resolveUserRole(actor.email, actor.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const adminClient = getAdminClient();
  const { data: accounts, error } = await adminClient
    .from("approved_discord_accounts")
    .select("discord_user_id, owner_user_id, label, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch approved Discord accounts." },
      { status: 500 }
    );
  }

  const ownerIds = Array.from(
    new Set(
      (accounts ?? [])
        .map((account) => String(account.owner_user_id ?? "").trim())
        .filter(Boolean)
    )
  );

  const ownerById = new Map<string, { full_name: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data: owners } = await adminClient
      .from("app_users")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const owner of owners ?? []) {
      ownerById.set(String(owner.id), {
        full_name: owner.full_name ?? null,
        email: owner.email ?? null,
      });
    }
  }

  return NextResponse.json({
    approvedAccounts: (accounts ?? []).map((account) => {
      const ownerId = String(account.owner_user_id ?? "").trim();
      const owner = ownerId ? ownerById.get(ownerId) ?? null : null;
      return {
        discord_user_id: account.discord_user_id,
        label: account.label ?? null,
        created_at: account.created_at,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);

  if (!actor || resolveUserRole(actor.email, actor.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const discordUserId = String(body?.discordUserId ?? "").trim();
  const label = String(body?.label ?? "").trim();
  const ownerEmail = String(body?.ownerEmail ?? "").trim().toLowerCase();

  if (!discordUserIdPattern.test(discordUserId)) {
    return NextResponse.json(
      { error: "Discord user ID must be a 17-20 digit number." },
      { status: 400 }
    );
  }

  const adminClient = getAdminClient();

  let ownerUserId: string | null = null;
  if (ownerEmail) {
    const { data: owner } = await adminClient
      .from("app_users")
      .select("id")
      .eq("email", ownerEmail)
      .maybeSingle();
    if (!owner) {
      return NextResponse.json(
        { error: `No account found with email ${ownerEmail}.` },
        { status: 400 }
      );
    }
    ownerUserId = owner.id;
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

  if (!actor || resolveUserRole(actor.email, actor.role ?? null) !== "founder") {
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
