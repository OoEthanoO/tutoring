import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isHighRankingChiefExecutive, resolveUserRole } from "@/lib/roles";
import { ensureTutorWithdrawalRequestsSchema } from "@/lib/withdrawalRequests";
import { sendEmail as sendNotificationEmail } from "@/lib/notificationsServer";
import {
  certificateFileName,
  generateServiceHoursCertificate,
} from "@/lib/serviceHoursCertificate";

const escapeHtmlValue = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type WithdrawalRow = {
  id: string;
  tutor_id: string;
  hours: number;
  start_date: string;
  end_date: string;
  created_at: string;
  created_by: string | null;
  tutor_legal_name: string;
};

type PendingRequestRow = {
  id: string;
  tutor_id: string;
  tutor_legal_name: string;
  hours: number;
  created_at: string;
};

type TutorUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type CourseRow = {
  id: string;
  title: string;
};

type CourseClassRow = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
  course_id: string;
  tutor_withdrawal_id: string | null;
};

// Automatically ensure the database schema exists
async function ensureTutorWithdrawalsSchema(adminClient: SupabaseClient) {
  try {
    await adminClient.rpc("execute_sql", {
      sql: `
        -- Create tutor_withdrawals table with tutor_legal_name column
        CREATE TABLE IF NOT EXISTS public.tutor_withdrawals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tutor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
          tutor_legal_name text NOT NULL DEFAULT '',
          hours numeric(6,2) NOT NULL,
          start_date timestamptz NOT NULL,
          end_date timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
        );

        -- Enable RLS on tutor_withdrawals
        ALTER TABLE public.tutor_withdrawals ENABLE ROW LEVEL SECURITY;

        -- Admins can view/insert tutor withdrawals (restricted to Founder, CEO, or COO)
        DROP POLICY IF EXISTS "Admins can view all withdrawals" ON public.tutor_withdrawals;
        CREATE POLICY "Admins can view all withdrawals" ON public.tutor_withdrawals
          FOR SELECT
          USING (
            EXISTS (
              SELECT 1 FROM public.app_users
              WHERE id = auth.uid() AND (role = 'founder' OR custom_role = 'CEO' OR custom_role = 'COO')
            )
          );

        DROP POLICY IF EXISTS "Admins can insert withdrawals" ON public.tutor_withdrawals;
        CREATE POLICY "Admins can insert withdrawals" ON public.tutor_withdrawals
          FOR INSERT
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM public.app_users
              WHERE id = auth.uid() AND (role = 'founder' OR custom_role = 'CEO' OR custom_role = 'COO')
            )
          );

        -- Create tutors own view policy if not exists
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_withdrawals' AND policyname = 'Tutors can view their own withdrawals') THEN
            CREATE POLICY "Tutors can view their own withdrawals" ON public.tutor_withdrawals
              FOR SELECT
              USING (auth.uid() = tutor_id);
          END IF;
        END $$;

        -- Add tutor_legal_name to tutor_withdrawals if it does not exist
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tutor_withdrawals' AND column_name='tutor_legal_name') THEN
            ALTER TABLE public.tutor_withdrawals ADD COLUMN tutor_legal_name text NOT NULL DEFAULT '';
          END IF;
        END $$;

        -- Add tutor_withdrawal_id to course_classes if it does not exist
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_classes' AND column_name='tutor_withdrawal_id') THEN
            ALTER TABLE public.course_classes 
            ADD COLUMN tutor_withdrawal_id uuid REFERENCES public.tutor_withdrawals(id) ON DELETE SET NULL;
          END IF;
        END $$;

        -- Notify PostgREST to reload schema
        NOTIFY pgrst, 'reload schema';
      `
    });
  } catch (error) {
    console.error("Dynamic migration execution failed:", error);
  }
}

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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((value): value is string => Boolean(value));

  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isHighRankingChiefExecutive(role)) {
    return NextResponse.json({ error: "Forbidden. Only high-level chief executives can access withdrawals." }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const tutorId = searchParams.get("tutorId");

  // Ensure table exists on first query invocation
  await ensureTutorWithdrawalsSchema(adminClient);

  if (!tutorId) {
    await ensureTutorWithdrawalRequestsSchema(adminClient);

    // Fetch all past withdrawals globally
    const { data: withdrawals, error: withdrawalsError } = await adminClient
      .from("tutor_withdrawals")
      .select("id, tutor_id, hours, start_date, end_date, created_at, created_by, tutor_legal_name")
      .order("created_at", { ascending: false });

    if (withdrawalsError) {
      return NextResponse.json({ error: withdrawalsError.message }, { status: 500 });
    }

    // Pending tutor-initiated withdrawal requests (oldest first for triage order)
    const { data: pendingRequestsData } = await adminClient
      .from("tutor_withdrawal_requests")
      .select("id, tutor_id, tutor_legal_name, hours, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    const pendingRequests = pendingRequestsData || [];

    const tutorIds = Array.from(
      new Set([
        ...(withdrawals || []).map((w: WithdrawalRow) => w.tutor_id),
        ...pendingRequests.map((r: PendingRequestRow) => r.tutor_id),
      ])
    );
    let enrichedWithdrawals = withdrawals || [];
    let enrichedPendingRequests = pendingRequests;

    if (tutorIds.length > 0) {
      const { data: usersData, error: usersError } = await adminClient
        .from("app_users")
        .select("id, full_name, email")
        .in("id", tutorIds);

      if (!usersError && usersData) {
        const usersMap = new Map(usersData.map((u: TutorUserRow) => [u.id, u]));
        enrichedWithdrawals = withdrawals.map((w: WithdrawalRow) => ({
          ...w,
          tutor: usersMap.get(w.tutor_id) || null
        }));
        enrichedPendingRequests = pendingRequests.map((r: PendingRequestRow) => ({
          ...r,
          tutor: usersMap.get(r.tutor_id) || null
        }));
      }
    }

    return NextResponse.json({
      withdrawals: enrichedWithdrawals,
      pendingRequests: enrichedPendingRequests,
    });
  }

  // Fetch tutor user details
  const { data: tutorUser, error: tutorUserError } = await adminClient
    .from("app_users")
    .select("id, full_name, legal_name, email")
    .eq("id", tutorId)
    .single();

  if (tutorUserError || !tutorUser) {
    return NextResponse.json({ error: tutorUserError?.message || "Tutor user not found." }, { status: 404 });
  }

  const tutorLegalName = String(tutorUser.legal_name ?? "").trim();

  // Fetch tutor's taught courses
  const { data: courses, error: coursesError } = await adminClient
    .from("courses")
    .select("id, title")
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);

  if (coursesError) {
    return NextResponse.json({ error: coursesError.message }, { status: 500 });
  }

  const courseIds = courses?.map((c: CourseRow) => c.id) || [];

  let classes: (CourseClassRow & { course_title: string })[] = [];
  if (courseIds.length > 0) {
    const { data: classesData, error: classesError } = await adminClient
      .from("course_classes")
      .select("id, title, starts_at, duration_hours, course_id, tutor_withdrawal_id")
      .in("course_id", courseIds)
      .order("starts_at", { ascending: true });

    if (classesError) {
      return NextResponse.json({ error: classesError.message }, { status: 500 });
    }

    // Attach course title to each class
    const coursesMap = new Map(courses.map((c: CourseRow) => [c.id, c.title]));
    classes = (classesData || []).map((cls: CourseClassRow) => ({
      ...cls,
      course_title: coursesMap.get(cls.course_id) || "Unknown Course"
    }));
  }

  // Fetch past withdrawals for the specific tutor (including tutor_legal_name at time of withdrawal)
  const { data: withdrawals, error: withdrawalsError } = await adminClient
    .from("tutor_withdrawals")
    .select("id, hours, start_date, end_date, created_at, created_by, tutor_legal_name")
    .eq("tutor_id", tutorId)
    .order("created_at", { ascending: false });

  if (withdrawalsError) {
    return NextResponse.json({ error: withdrawalsError.message }, { status: 500 });
  }

  return NextResponse.json({
    classes,
    withdrawals,
    tutor: {
      id: tutorUser.id,
      fullName: tutorUser.full_name,
      legalName: tutorLegalName || null,
      email: tutorUser.email
    }
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const customRoleLevels = Array.isArray(user.custom_roles)
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((value): value is string => Boolean(value));

  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isHighRankingChiefExecutive(role)) {
    return NextResponse.json({ error: "Forbidden. Only high-level chief executives can perform withdrawals." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { tutorId, hours, confirm } = body;

  if (!tutorId) {
    return NextResponse.json({ error: "Missing tutorId." }, { status: 400 });
  }

  if (typeof hours !== "number" || hours <= 0) {
    return NextResponse.json({ error: "Hours must be a positive number." }, { status: 400 });
  }

  if (hours % 1.5 !== 0) {
    return NextResponse.json({ error: "Withdrawn hours must be a multiple of 1.5 hours." }, { status: 400 });
  }

  // Ensure database schema exists
  await ensureTutorWithdrawalsSchema(adminClient);

  // Fetch tutor user details and check legal name
  const { data: tutorUser, error: tutorUserError } = await adminClient
    .from("app_users")
    .select("id, full_name, legal_name, email, grade")
    .eq("id", tutorId)
    .single();

  if (tutorUserError || !tutorUser) {
    return NextResponse.json({ error: tutorUserError?.message || "Tutor user not found." }, { status: 404 });
  }

  const tutorLegalName = String(tutorUser.legal_name ?? "").trim();
  if (!tutorLegalName) {
    return NextResponse.json({
      error: `Tutor "${tutorUser.full_name || tutorUser.email}" does not have their legal name set. Hours can only be withdrawn from tutors with a legal name set.`,
      code: "tutor_missing_legal_name"
    }, { status: 400 });
  }

  // Fetch tutor's taught courses
  const { data: courses, error: coursesError } = await adminClient
    .from("courses")
    .select("id")
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);

  if (coursesError) {
    return NextResponse.json({ error: coursesError.message }, { status: 500 });
  }

  const courseIds = courses?.map((c: Pick<CourseRow, "id">) => c.id) || [];
  if (courseIds.length === 0) {
    return NextResponse.json({ error: "This tutor has not taught any courses." }, { status: 400 });
  }

  // Fetch classes belonging to these courses that have started and are not yet withdrawn
  const nowStr = new Date().toISOString();
  const { data: availableClasses, error: classesError } = await adminClient
    .from("course_classes")
    .select("id, title, starts_at, duration_hours")
    .in("course_id", courseIds)
    .lte("starts_at", nowStr)
    .is("tutor_withdrawal_id", null)
    .order("starts_at", { ascending: true });

  if (classesError) {
    return NextResponse.json({ error: classesError.message }, { status: 500 });
  }

  const classesCount = availableClasses?.length || 0;
  const numClassesToWithdraw = hours / 1.5;

  if (classesCount < numClassesToWithdraw) {
    return NextResponse.json({
      error: `Tutor has only ${classesCount * 1.5} hours available (${classesCount} taught classes), which is less than the requested ${hours} hours.`
    }, { status: 400 });
  }

  // Select the oldest N classes
  const selectedClasses = (availableClasses || []).slice(0, numClassesToWithdraw);
  const startDate = selectedClasses[0].starts_at;
  const endDate = selectedClasses[selectedClasses.length - 1].starts_at;
  const selectedClassIds = selectedClasses.map((c: Pick<CourseClassRow, "id">) => c.id);

  if (confirm) {
    // Perform withdrawal with legal name audit
    const { data: withdrawal, error: withdrawalError } = await adminClient
      .from("tutor_withdrawals")
      .insert({
        tutor_id: tutorId,
        tutor_legal_name: tutorLegalName,
        hours: hours,
        start_date: startDate,
        end_date: endDate,
        created_by: user.id
      })
      .select()
      .single();

    if (withdrawalError) {
      return NextResponse.json({ error: withdrawalError.message }, { status: 500 });
    }

    // Mark classes as withdrawn
    const { error: updateError } = await adminClient
      .from("course_classes")
      .update({ tutor_withdrawal_id: withdrawal.id })
      .in("id", selectedClassIds);

    if (updateError) {
      // Rollback withdrawal record if class update fails
      await adminClient.from("tutor_withdrawals").delete().eq("id", withdrawal.id);
      return NextResponse.json({ error: `Failed to mark classes as withdrawn: ${updateError.message}` }, { status: 500 });
    }

    // Auto-fulfill any pending withdrawal request from this tutor — the admin has
    // handled their balance, regardless of whether the amounts match exactly.
    // Non-fatal: a failure here must not fail the withdrawal itself.
    try {
      await ensureTutorWithdrawalRequestsSchema(adminClient);
      await adminClient
        .from("tutor_withdrawal_requests")
        .update({
          status: "fulfilled",
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
        })
        .eq("tutor_id", tutorId)
        .eq("status", "pending");
    } catch (error) {
      console.error("Failed to auto-fulfill withdrawal request:", error);
    }

    // Email the filled community-service-hours form to the tutor. Non-fatal.
    let certificateEmailSent = false;
    try {
      const tutorEmail = String(tutorUser.email ?? "").trim();
      if (tutorEmail) {
        const pdfBytes = await generateServiceHoursCertificate({
          legalName: tutorLegalName,
          grade: (tutorUser.grade as string | null) ?? null,
          hours: Number(withdrawal.hours),
          startDate: String(withdrawal.start_date),
          endDate: String(withdrawal.end_date),
        });
        const fileName = certificateFileName(tutorLegalName, Number(withdrawal.hours));
        const startLabel = new Date(String(withdrawal.start_date)).toLocaleDateString("en-US", {
          timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric",
        });
        const endLabel = new Date(String(withdrawal.end_date)).toLocaleDateString("en-US", {
          timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric",
        });
        certificateEmailSent = await sendNotificationEmail(
          tutorEmail,
          `Your community service hours form — ${Number(withdrawal.hours)} hours`,
          `<p>Hi ${escapeHtmlValue(tutorLegalName)},</p>
<p>Your withdrawal of <strong>${Number(withdrawal.hours)} hours</strong> (${escapeHtmlValue(startLabel)} &ndash; ${escapeHtmlValue(endLabel)}) has been completed. Your filled community service hours form is attached.</p>
<p>The <strong>verification section at the bottom</strong> of the form is to be completed by your school.</p>
<p>Thanks,<br/>The YanLearn Team</p>`,
          [{ filename: fileName, content: Buffer.from(pdfBytes).toString("base64") }]
        );
      }
    } catch (error) {
      console.error("Failed to email service-hours certificate:", error);
    }

    return NextResponse.json({
      success: true,
      certificateEmailSent,
      withdrawal: {
        id: withdrawal.id,
        tutorId: withdrawal.tutor_id,
        tutorLegalName: withdrawal.tutor_legal_name,
        hours: Number(withdrawal.hours),
        startDate: withdrawal.start_date,
        endDate: withdrawal.end_date,
        createdAt: withdrawal.created_at
      }
    });
  }

  // Otherwise, return preview with legal name
  return NextResponse.json({
    valid: true,
    hours,
    numClasses: numClassesToWithdraw,
    startDate,
    endDate,
    tutorLegalName
  });
}

// Resolve a tutor-initiated withdrawal request (decline it, or mark fulfilled
// without performing a withdrawal).
export async function PATCH(request: NextRequest) {
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
    ? user.custom_roles.map((r) => r.role_level).filter(Boolean)
    : [user.custom_roles?.role_level].filter((value): value is string => Boolean(value));

  const role = resolveUserRole(user.email, user.role ?? null, customRoleLevels);
  if (!isHighRankingChiefExecutive(role)) {
    return NextResponse.json({ error: "Forbidden. Only high-level chief executives can resolve withdrawal requests." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestId = String(body?.requestId ?? "").trim();
  const status = String(body?.status ?? "").trim();

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId." }, { status: 400 });
  }
  if (status !== "fulfilled" && status !== "declined") {
    return NextResponse.json({ error: "Status must be \"fulfilled\" or \"declined\"." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  await ensureTutorWithdrawalRequestsSchema(adminClient);

  // The status guard makes concurrent resolutions race-safe: only one wins.
  const { data: updated, error: updateError } = await adminClient
    .from("tutor_withdrawal_requests")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id, tutor_id, tutor_legal_name, hours, status, created_at, resolved_at");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "Request was already resolved or does not exist." },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, request: updated[0] });
}
