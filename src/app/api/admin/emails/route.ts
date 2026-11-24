import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import { isHighRankingChiefExecutive, resolveUserRole } from "@/lib/roles";

type EmailLogRow = {
  id: number | string;
  created_at: string | null;
  from_address: string | null;
  to_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  status: string | null;
  error: string | null;
  html?: string | null;
};

const listColumns =
  "id, created_at, from_address, to_addresses, bcc_addresses, subject, status, error";

const normalizeEmail = (row: EmailLogRow) => ({
  id: String(row.id),
  to: row.to_addresses ?? [],
  bcc: row.bcc_addresses ?? [],
  cc: [] as string[],
  from: row.from_address ?? "",
  subject: row.subject || "(no subject)",
  createdAt: row.created_at ?? "",
  lastEvent: row.status ?? null,
  error: row.error ?? null,
});

/**
 * Returns the site's email history from public.email_log, which
 * src/lib/mailer.ts writes on every send. Founder/CEO/COO only.
 *
 * Emails sent before the move from Resend to Gmail (November 2026) were never
 * logged here, so they are not listed.
 *
 * Query params:
 *   - id: retrieve a single email (including its html body)
 *   - limit / after: pagination for the list view (after = the last id shown)
 */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const customRoleLevels = (
    Array.isArray(user.custom_roles)
      ? user.custom_roles.map((r) => r.role_level)
      : [user.custom_roles?.role_level]
  ).filter((level): level is string => Boolean(level));
  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);

  if (!isHighRankingChiefExecutive(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const adminClient = getAdminClient();
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id")?.trim();

  // Single email — includes the full html body.
  if (id) {
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }
    const { data, error } = await adminClient
      .from("email_log")
      .select(`${listColumns}, html`)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: "Failed to load email." }, { status: 502 });
    }
    if (!data) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }
    const row = data as EmailLogRow;
    return NextResponse.json({
      email: { ...normalizeEmail(row), html: row.html ?? null, text: null },
    });
  }

  // List view, newest first.
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);
  const after = searchParams.get("after")?.trim();

  let query = adminClient
    .from("email_log")
    .select(listColumns)
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (after && /^\d+$/.test(after)) {
    query = query.lt("id", after);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load email history." }, { status: 502 });
  }

  const rows = (data ?? []) as EmailLogRow[];
  const emails = rows.slice(0, limit).map(normalizeEmail);

  return NextResponse.json({
    emails,
    hasMore: rows.length > limit,
    nextCursor: emails.length > 0 ? emails[emails.length - 1].id : null,
  });
}
