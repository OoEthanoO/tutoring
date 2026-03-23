import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await supabase.from('class_reminder_logs').delete().in('class_id', ['14014a0f-5d66-43a4-8465-d15a775e4e81', '277024ae-a8d7-44d3-8fc4-6d6a533ce2ab']);
console.log('Deleted logs');
