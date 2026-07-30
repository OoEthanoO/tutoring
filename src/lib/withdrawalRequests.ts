import type { SupabaseClient } from "@supabase/supabase-js";
import { hoursPerClassForGrade, sumHours, withdrawableHourSteps } from "@/lib/serviceHours";

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

        -- Add grade_level to courses if it does not exist. It sets the per-class
        -- service-hour rate, and reading it is how availability is calculated, so
        -- a missing column would silently report zero withdrawable hours.
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='grade_level') THEN
            ALTER TABLE public.courses ADD COLUMN grade_level smallint;
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
  /** Per-class hours of the available classes, oldest first. */
  availableClassHours: number[];
  /** Valid withdrawal amounts: the running totals of `availableClassHours`. */
  hourSteps: number[];
};

// Availability math identical to the admin withdrawals POST handler (the source of
// truth): every past class in the tutor's non-deleted courses is worth the rate
// for its course's grade level (2 hours at grade 11/12, otherwise 1.5), minus
// classes already stamped with a tutor_withdrawal_id. Withdrawn hours come from
// the withdrawal records themselves, so past certificates stay authoritative even
// if a course's grade level is changed afterwards.
export async function getTutorAvailability(
  adminClient: SupabaseClient,
  tutorId: string
): Promise<TutorAvailability> {
  const empty: TutorAvailability = {
    availableHours: 0,
    withdrawnHours: 0,
    taughtClassCount: 0,
    availableClassHours: [],
    hourSteps: [],
  };

  const { data: courses } = await adminClient
    .from("courses")
    .select("id, grade_level")
    .is("deleted_at", null)
    .or(`created_by.eq.${tutorId},co_tutor_id.eq.${tutorId}`);

  const courseIds = (courses ?? []).map((c: { id: string }) => c.id);

  const { data: withdrawalRows } = await adminClient
    .from("tutor_withdrawals")
    .select("hours")
    .eq("tutor_id", tutorId);

  const withdrawnHours = sumHours(
    (withdrawalRows ?? []).map((row: { hours: number | string }) => Number(row.hours) || 0)
  );

  if (courseIds.length === 0) {
    return { ...empty, withdrawnHours };
  }

  const hoursByCourse = new Map(
    (courses ?? []).map((course: { id: string; grade_level: number | null }) => [
      course.id,
      hoursPerClassForGrade(course.grade_level),
    ])
  );

  const nowStr = new Date().toISOString();
  const { data: pastClasses } = await adminClient
    .from("course_classes")
    .select("id, course_id, tutor_withdrawal_id")
    .in("course_id", courseIds)
    .lte("starts_at", nowStr)
    .order("starts_at", { ascending: true });

  const taught = pastClasses ?? [];
  const availableClassHours = taught
    .filter(
      (cls: { tutor_withdrawal_id: string | null }) => cls.tutor_withdrawal_id === null
    )
    .map((cls: { course_id: string }) => hoursByCourse.get(cls.course_id) ?? 0);

  return {
    availableHours: sumHours(availableClassHours),
    withdrawnHours,
    taughtClassCount: taught.length,
    availableClassHours,
    hourSteps: withdrawableHourSteps(availableClassHours),
  };
}
