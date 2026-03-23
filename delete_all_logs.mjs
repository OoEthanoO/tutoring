import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await supabase.from('class_reminder_logs').delete().in('reminder_type', ['seven_days', 'five_minutes', 'twenty_four_hours', 'one_hour']);
console.log('Deleted all logs');
