require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data: courses } = await supabase.from('courses').select('id, created_by, is_completed, completed_class_count').eq('is_completed', true).limit(5);
  console.log('courses:', courses);
  const { data: classes } = await supabase.from('course_classes').select('*').limit(5);
  console.log('classes:', classes);
}
run();
