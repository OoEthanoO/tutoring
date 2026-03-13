require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('url:', url);
console.log('key prefix:', key ? key.substring(0, 10) : 'undefined');
const supabase = createClient(url, key);
supabase.from('app_users').select('*').limit(1).then(console.log).catch(console.error);
