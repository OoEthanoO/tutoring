const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data, error } = await supabase.rpc('get_tables'); // This might not work depending on permissions
  if (error) {
    // Fallback: try to select from a common table
    const { data: tables, error: tablesError } = await supabase.from('pg_tables').select('tablename').eq('schemaname', 'public');
    if (tablesError) {
        console.log("Error fetching tables:", tablesError);
    } else {
        console.log("Tables:", tables.map(t => t.tablename));
    }
  } else {
    console.log("Tables:", data);
  }
}
run();
