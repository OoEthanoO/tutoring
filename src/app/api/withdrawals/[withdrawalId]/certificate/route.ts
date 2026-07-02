import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isHighRankingChiefExecutive, resolveUserRole } from "@/lib/roles";
import {
  CertificateFieldError,
  certificateFileName,
  generateServiceHoursCertificate,
} from "@/lib/serviceHoursCertificate";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Downloads the filled community-service-hours form for a completed withdrawal.
 * Available to founders/CEOs/COOs and to the withdrawal's own tutor.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { withdrawalId: string } | Promise<{ withdrawalId: string }> }
) {
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

  const resolvedParams = await params;
  const withdrawalId = String(resolvedParams?.withdrawalId ?? "").trim();
  if (!withdrawalId) {
    return NextResponse.json({ error: "Missing withdrawal id." }, { status: 400 });
  }

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles
        .map((r: { role_level?: string }) => r.role_level)
        .filter((level): level is string => Boolean(level))
    : [user.custom_roles?.role_level].filter((level): level is string => Boolean(level));
  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: withdrawal, error: withdrawalError } = await adminClient
    .from("tutor_withdrawals")
    .select("id, tutor_id, tutor_legal_name, hours, start_date, end_date")
    .eq("id", withdrawalId)
    .single();

  if (withdrawalError || !withdrawal) {
    return NextResponse.json({ error: "Withdrawal not found." }, { status: 404 });
  }

  const isOwner = String(withdrawal.tutor_id) === String(user.id);
  if (!isHighRankingChiefExecutive(role) && !isOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data: tutor } = await adminClient
    .from("app_users")
    .select("legal_name, full_name, grade")
    .eq("id", withdrawal.tutor_id)
    .single();

  const legalName =
    String(withdrawal.tutor_legal_name ?? "").trim() ||
    String(tutor?.legal_name ?? "").trim() ||
    String(tutor?.full_name ?? "").trim();
  if (!legalName) {
    return NextResponse.json(
      { error: "Tutor legal name missing — ask the tutor to set it in their profile." },
      { status: 400 }
    );
  }

  try {
    const pdfBytes = await generateServiceHoursCertificate({
      legalName,
      grade: (tutor?.grade as string | null) ?? null,
      hours: Number(withdrawal.hours),
      startDate: String(withdrawal.start_date),
      endDate: String(withdrawal.end_date),
    });

    const fileName = certificateFileName(legalName, Number(withdrawal.hours));
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    if (error instanceof CertificateFieldError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate the form." },
      { status: 500 }
    );
  }
}
