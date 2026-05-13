import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS public.daily_donations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          date DATE NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE public.daily_donations ENABLE ROW LEVEL SECURITY;

      CREATE POLICY "Allow public read access to daily donations"
          ON public.daily_donations FOR SELECT
          USING (true);
    `
  });
  
  if (error) {
    if (error.message.includes("Could not find the function")) {
        console.log("No execute_sql function. It's fine, we will just use standard migrations instead or do it differently.");
        process.exit(1);
    }
    console.error("Error creating table:", error);
  } else {
    console.log("Table created successfully");
  }
}

run();
