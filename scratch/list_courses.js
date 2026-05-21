const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, is_completed, created_at");
  
  if (error) {
    console.error("DB Error:", error);
  } else {
    console.log("All courses in database:");
    console.log(JSON.stringify(courses, null, 2));
  }
}

run();
