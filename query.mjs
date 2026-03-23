import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('class_reminder_logs').select('*').in('reminder_type', ['seven_days', 'five_minutes']);
console.log(data);
