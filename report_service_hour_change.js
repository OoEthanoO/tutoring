/**
 * READ-ONLY. Reports what the switch from per-class to per-teaching-hour service
 * hours does to every tutor's *unwithdrawn* balance, so the change can be checked
 * before it ships.
 *
 *   node report_service_hour_change.js
 *
 * Old rule: each taught class = 1.5 hours (2 at grade 11/12).
 * New rule: each taught class = its duration x 1.5 (or x 2).
 *
 * Only classes that have started and are not already stamped with a withdrawal
 * are counted — completed withdrawals are historical records and are never
 * recomputed, so they cannot change.
 */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const SENIOR_GRADES = [11, 12];
const round2 = (v) => Math.round(v * 100) / 100;

const multiplier = (gradeLevel) => {
  const grade = Number.parseInt(String(gradeLevel ?? ''), 10);
  return Number.isInteger(grade) && SENIOR_GRADES.includes(grade) ? 2 : 1.5;
};

const teachingHours = (value) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('[SENSITIVE')) {
    console.error(
      'Missing real Supabase credentials in .env.local (Vercel redacts sensitive values on pull —\n' +
        'copy the service_role key from the Supabase dashboard instead).'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: courses, error: coursesError } = await supabase
    .from('courses')
    .select('id, title, grade_level, created_by, created_by_name, co_tutor_id')
    .is('deleted_at', null);
  if (coursesError) {
    console.error('Failed to load courses:', coursesError.message);
    process.exit(1);
  }

  const courseById = new Map((courses || []).map((c) => [c.id, c]));
  const nowStr = new Date().toISOString();

  const { data: classes, error: classesError } = await supabase
    .from('course_classes')
    .select('id, course_id, duration_hours, starts_at, tutor_withdrawal_id')
    .lte('starts_at', nowStr)
    .is('tutor_withdrawal_id', null);
  if (classesError) {
    console.error('Failed to load classes:', classesError.message);
    process.exit(1);
  }

  // Attribute each class to the tutors who run its course.
  const perTutor = new Map();
  const durationHistogram = new Map();

  for (const cls of classes || []) {
    const course = courseById.get(cls.course_id);
    if (!course) continue;

    const rate = multiplier(course.grade_level);
    const hours = teachingHours(cls.duration_hours);
    const oldValue = rate;
    const newValue = round2(hours * rate);

    const minutes = Math.round(hours * 60);
    durationHistogram.set(minutes, (durationHistogram.get(minutes) ?? 0) + 1);

    for (const tutorId of [course.created_by, course.co_tutor_id]) {
      if (!tutorId) continue;
      const entry = perTutor.get(tutorId) ?? {
        name: course.created_by_name || tutorId,
        classes: 0,
        oldHours: 0,
        newHours: 0,
      };
      entry.classes += 1;
      entry.oldHours = round2(entry.oldHours + oldValue);
      entry.newHours = round2(entry.newHours + newValue);
      perTutor.set(tutorId, entry);
    }
  }

  console.log('\nClass length distribution (unwithdrawn, already taught):');
  for (const [minutes, count] of [...durationHistogram].sort((a, b) => a[0] - b[0])) {
    const note = minutes === 60 ? '  (unchanged by this switch)' : '';
    console.log(`  ${String(minutes).padStart(4)} min  x${count}${note}`);
  }

  const rows = [...perTutor.values()]
    .map((r) => ({ ...r, delta: round2(r.newHours - r.oldHours) }))
    .sort((a, b) => a.delta - b.delta);

  console.log('\nPer-tutor withdrawable balance, old rule vs new rule:');
  let unchanged = 0;
  for (const r of rows) {
    if (r.delta === 0) {
      unchanged += 1;
      continue;
    }
    const sign = r.delta > 0 ? '+' : '';
    console.log(
      `  ${r.name.padEnd(28)} ${String(r.oldHours).padStart(7)} -> ${String(r.newHours).padStart(7)}  (${sign}${r.delta})`
    );
  }
  console.log(`  ...and ${unchanged} tutor(s) unaffected.`);

  const losers = rows.filter((r) => r.delta < 0);
  console.log(
    `\n${rows.length} tutor(s) with a balance; ${losers.length} would lose hours, ` +
      `${rows.filter((r) => r.delta > 0).length} would gain.`
  );
  if (losers.length > 0) {
    console.log(
      'Tutors lose hours only where classes are shorter than 60 minutes, since those\n' +
        'previously earned a full 1.5/2 regardless of length. Consider whether those\n' +
        'balances should be grandfathered before deploying.'
    );
  }
  console.log('\nCompleted withdrawals are untouched: they are read from their records, never recomputed.');
}

main().catch((e) => console.error('report failed:', e.message));
