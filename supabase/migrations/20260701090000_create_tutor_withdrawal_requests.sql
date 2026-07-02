-- Tutor-initiated hour withdrawal requests. A request is resolved either by an
-- admin performing the actual withdrawal (fulfilled) or declining it.
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

-- One pending request per tutor (race-safe at the DB level).
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

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
