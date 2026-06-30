import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { isHighRankingChiefExecutive, resolveUserRole } from "@/lib/roles";

const resendApiKey = process.env.RESEND_API_KEY ?? "";

type ResendEmail = {
  id?: string;
  to?: string | string[] | null;
  bcc?: string | string[] | null;
  cc?: string | string[] | null;
  from?: string | null;
  subject?: string | null;
  created_at?: string | null;
  last_event?: string | null;
  html?: string | null;
  text?: string | null;
};

const toRecipients = (value: string | string[] | null | undefined): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const normalizeEmail = (email: ResendEmail) => ({
  id: email.id ?? "",
  to: toRecipients(email.to),
  bcc: toRecipients(email.bcc),
  cc: toRecipients(email.cc),
  from: email.from ?? "",
  subject: email.subject ?? "(no subject)",
  createdAt: email.created_at ?? "",
  lastEvent: email.last_event ?? null,
});

/**
 * Returns email history from Resend. Founder/CEO/COO only.
 *
 * Resend retains every email sent through the account, so this surfaces all
 * emails — including ones sent before this feature existed, since nothing is
 * stored locally.
 *
 * Query params:
 *   - id: retrieve a single email (including its html/text body)
 *   - limit / after: cursor-based pagination for the list view
 */
export async function GET(request: NextRequest) {
  if (!resendApiKey) {
    return NextResponse.json(
      { error: "Email history is unavailable: missing Resend configuration." },
      { status: 500 }
    );
  }

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

  const authHeaders = { Authorization: `Bearer ${resendApiKey}` };
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id")?.trim();

  // Single email — includes the full html/text body.
  if (id) {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
      headers: authHeaders,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: detail || "Failed to load email." },
        { status: response.status === 404 ? 404 : 502 }
      );
    }
    const email = (await response.json()) as ResendEmail;
    return NextResponse.json({
      email: {
        ...normalizeEmail(email),
        html: email.html ?? null,
        text: email.text ?? null,
      },
    });
  }

  // List view — cursor-based pagination.
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);
  const after = searchParams.get("after")?.trim();

  const listUrl = new URL("https://api.resend.com/emails");
  listUrl.searchParams.set("limit", String(limit));
  if (after) {
    listUrl.searchParams.set("after", after);
  }

  const response = await fetch(listUrl, { headers: authHeaders });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return NextResponse.json(
      { error: detail || "Failed to load email history." },
      { status: 502 }
    );
  }

  const payload = (await response.json()) as {
    data?: ResendEmail[];
    has_more?: boolean;
  };
  const emails = (payload.data ?? []).map(normalizeEmail);

  return NextResponse.json({
    emails,
    hasMore: Boolean(payload.has_more),
    nextCursor: emails.length > 0 ? emails[emails.length - 1].id : null,
  });
}
