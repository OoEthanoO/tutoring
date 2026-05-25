-- Create tutor_withdrawals table
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

-- Create policies for tutor_withdrawals
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_withdrawals' AND policyname = 'Admins can view all withdrawals') THEN
    CREATE POLICY "Admins can view all withdrawals" ON public.tutor_withdrawals
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.app_users
          WHERE id = auth.uid() AND (role = 'founder' or role = 'executive')
        )
      );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_withdrawals' AND policyname = 'Admins can insert withdrawals') THEN
    CREATE POLICY "Admins can insert withdrawals" ON public.tutor_withdrawals
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.app_users
          WHERE id = auth.uid() AND (role = 'founder' or role = 'executive')
        )
      );
  END IF;

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
