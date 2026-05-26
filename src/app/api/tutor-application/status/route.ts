import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Automatically ensure the database schema exists for tutor_applications
async function ensureTutorApplicationsSchema(adminClient: any) {
  try {
    await adminClient.rpc("execute_sql", {
      sql: `
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
      `
    });
  } catch (error) {
    console.error("Tutor applications schema setup failed:", error);
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

  // Run schema auto-migration
  await ensureTutorApplicationsSchema(adminClient);

  // Fetch the application for the current user
  const { data: application, error } = await adminClient
    .from("tutor_applications")
    .select("id, full_name, email, phone_number, current_grade, parents_phone_number, consent_signature, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    completed: Boolean(application),
    application: application || null,
  });
}
export { ensureTutorApplicationsSchema };
