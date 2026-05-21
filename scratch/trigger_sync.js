const { createClient } = require("@supabase/supabase-js");
const { runDiscordSync } = require("../src/lib/discordSync.ts");
require("dotenv").config({ path: ".env.local" });

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
  console.log("Starting Discord Sync...");
  try {
    // We register the ts-node loader so we can import TypeScript directly
    const result = await runDiscordSync({ adminClient });
    console.log("Sync completed successfully!");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Sync failed:", error);
  }
}

run();
