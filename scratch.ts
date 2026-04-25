import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  const { data: users, error } = await adminClient.auth.admin.listUsers();
  console.log(users.users[0]);
}

main();
