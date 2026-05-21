import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function run() {
  const { data: courses, error } = await adminClient
    .from("courses")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching courses:", error);
    return;
  }

  console.log("=== All Courses in DB ===");
  for (const c of courses || []) {
    console.log(`- ID: ${c.id}`);
    console.log(`  Title: "${c.title}"`);
    console.log(`  Completed: ${c.is_completed}`);
    console.log(`  Deleted At: ${c.deleted_at}`);
    console.log(`  Created At: ${c.created_at}`);
  }
}

run().catch(console.error);
