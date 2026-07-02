import type { SupabaseClient } from "@supabase/supabase-js";

// Automatically ensure the tutor_withdrawal_requests schema exists, mirroring the
// ensureTutorWithdrawalsSchema pattern in the admin withdrawals route.
export async function ensureTutorWithdrawalRequestsSchema(adminClient: SupabaseClient) {
  try {
    await adminClient.rpc("execute_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS public.tutor_withdrawal_requests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tutor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
          tutor_legal_name text NOT NULL DEFAULT '',
          hours numeric(6,2) NOT NULL,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','declined')),
          created_at timestamptz NOT NULL DEFAULT now(),
          resolved_at timestamptz,
          resolved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS tutor_withdrawal_requests_one_pending
          ON public.tutor_withdrawal_requests (tutor_id) WHERE status = 'pending';

        ALTER TABLE public.tutor_withdrawal_requests ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Admins can view all withdrawal requests" ON public.tutor_withdrawal_requests;
        CREATE POLICY "Admins can view all withdrawal requests" ON public.tutor_withdrawal_requests
          FOR SELECT
          USING (
            EXISTS (
              SELECT 1 FROM public.app_users
              WHERE id = auth.uid() AND (role = 'founder' OR custom_role = 'CEO' OR custom_role = 'COO')
            )
          );

        DROP POLICY IF EXISTS "Admins can update withdrawal requests" ON public.tutor_withdrawal_requests;
        CREATE POLICY "Admins can update withdrawal requests" ON public.tutor_withdrawal_requests
          FOR UPDATE
          USING (
            EXISTS (
              SELECT 1 FROM public.app_users
              WHERE id = auth.uid() AND (role = 'founder' OR custom_role = 'CEO' OR custom_role = 'COO')
            )
          );

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_withdrawal_requests' AND policyname = 'Tutors can view their own withdrawal requests') THEN
            CREATE POLICY "Tutors can view their own withdrawal requests" ON public.tutor_withdrawal_requests
              FOR SELECT
              USING (auth.uid() = tutor_id);
          END IF;
        END $$;

        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_withdrawal_requests' AND policyname = 'Tutors can insert their own withdrawal requests') THEN
            CREATE POLICY "Tutors can insert their own withdrawal requests" ON public.tutor_withdrawal_requests
              FOR INSERT
              WITH CHECK (auth.uid() = tutor_id AND status = 'pending');
          END IF;
        END $$;

        NOTIFY pgrst, 'reload schema';
      `,
    });
  } catch (error) {
    console.error("Dynamic migration execution failed:", error);
  }
}

export type TutorAvailability = {
  availableHours: number;
  withdrawnHours: number;
  taughtClassCount: number;
};

// Availability math identical to the admin withdrawals POST handler (the source of
// truth): 1.5 hours per past class in the tutor's non-deleted courses, minus
// classes already stamped with a tutor_withdrawal_id.
export async function getTutorAvailability(
  adminClient: SupabaseClient,
  tutorId: string
): Promise<TutorAvailability> {
  const { data: courses } = await adminClient
    .from("courses")
    .select("id")
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);

  const courseIds = (courses ?? []).map((c: { id: string }) => c.id);
  if (courseIds.length === 0) {
    return { availableHours: 0, withdrawnHours: 0, taughtClassCount: 0 };
  }

  const nowStr = new Date().toISOString();
  const { data: pastClasses } = await adminClient
    .from("course_classes")
    .select("id, tutor_withdrawal_id")
    .in("course_id", courseIds)
    .lte("starts_at", nowStr);

  const taught = pastClasses ?? [];
  const withdrawnCount = taught.filter(
    (cls: { tutor_withdrawal_id: string | null }) => cls.tutor_withdrawal_id !== null
  ).length;
  const availableCount = taught.length - withdrawnCount;

  return {
    availableHours: availableCount * 1.5,
    withdrawnHours: withdrawnCount * 1.5,
    taughtClassCount: taught.length,
  };
}
