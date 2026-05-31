require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing credentials'); process.exit(1); }

async function run() {
  const response = await fetch(`${supabaseUrl}/rest/v1/site_settings?select=*`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  });
  const data = await response.json();
  console.log('site_settings rows:', data);
}
run();
