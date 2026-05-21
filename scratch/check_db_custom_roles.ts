import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env vars in .env.local");
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function run() {
  const { data: roles, error } = await adminClient
    .from("custom_roles")
    .select("*");

  if (error) {
    console.error("Error fetching custom_roles:", error);
    return;
  }

  console.log("=== Custom Roles in Database ===");
  for (const r of roles || []) {
    console.log(`- Name: "${r.name}", Level: "${r.role_level}"`);
  }
}

run().catch(console.error);
