-- Create tutor_applications table
CREATE TABLE IF NOT EXISTS public.tutor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone_number text NOT NULL,
  current_grade text NOT NULL,
  parents_phone_number text NOT NULL,
  consent_signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on tutor_applications
ALTER TABLE public.tutor_applications ENABLE ROW LEVEL SECURITY;

-- Create policies for tutor_applications
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_applications' AND policyname = 'Users can view their own application') THEN
    CREATE POLICY "Users can view their own application" ON public.tutor_applications
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutor_applications' AND policyname = 'Users can insert their own application') THEN
    CREATE POLICY "Users can insert their own application" ON public.tutor_applications
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Admins can view all tutor applications (restricted to Founder, CEO, or COO)
DROP POLICY IF EXISTS "Admins can view all tutor applications" ON public.tutor_applications;
CREATE POLICY "Admins can view all tutor applications" ON public.tutor_applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND (role = 'founder' OR custom_role = 'CEO' OR custom_role = 'COO')
    )
  );

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
