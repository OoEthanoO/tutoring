-- Private class exercises. All access is through authenticated server routes.
create table public.class_exercise_rooms (
  class_id uuid primary key references public.course_classes(id) on delete cascade,
  current_question_id uuid,
  announced_at timestamptz,
  announcement_claimed_at timestamptz
);
create table public.class_exercise_questions (
  id uuid primary key,
  class_id uuid not null references public.class_exercise_rooms(class_id) on delete cascade,
  number integer not null,
  prompt text not null check (length(btrim(prompt)) > 0 and length(prompt) <= 16000),
  opened_at timestamptz not null,
  closes_at timestamptz not null,
  stopped_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  unique(class_id, number)
);
create table public.class_exercise_submissions (
  id uuid primary key,
  question_id uuid not null references public.class_exercise_questions(id) on delete cascade,
  student_id uuid not null references public.app_users(id) on delete cascade,
  attempt integer not null,
  answer text not null check (length(btrim(answer)) > 0 and length(answer) <= 30000),
  status text not null default 'pending' check (status in ('pending', 'correct', 'incorrect')),
  feedback text not null default '' check (length(feedback) <= 10000),
  submitted_at timestamptz not null,
  graded_at timestamptz,
  graded_by uuid references public.app_users(id) on delete set null,
  unique(question_id, student_id, attempt)
);
create index class_exercise_submissions_student on public.class_exercise_submissions(student_id, question_id);
alter table public.class_exercise_rooms enable row level security;
alter table public.class_exercise_questions enable row level security;
alter table public.class_exercise_submissions enable row level security;
create policy "deny direct room access" on public.class_exercise_rooms for all using (false) with check (false);
create policy "deny direct question access" on public.class_exercise_questions for all using (false) with check (false);
create policy "deny direct submission access" on public.class_exercise_submissions for all using (false) with check (false);

-- Every mutation locks the same room first. A queued submission checks the actual
-- database clock AFTER acquiring this lock, so it cannot sneak past a deadline,
-- a stop, or a replacement question. RPC access is service-role only; routes
-- authorize the actor against the class before calling it.
create function public.class_exercise_action(p_class_id uuid, p_actor uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  room public.class_exercise_rooms%rowtype;
  question public.class_exercise_questions%rowtype;
  submission public.class_exercise_submissions%rowtype;
  previous public.class_exercise_submissions%rowtype;
  stamp timestamptz;
  item_id uuid;
  seconds integer;
  next_number integer;
begin
  insert into public.class_exercise_rooms(class_id) values(p_class_id) on conflict do nothing;
  select * into room from public.class_exercise_rooms where class_id = p_class_id for update;
  stamp := clock_timestamp();

  if p_action = 'publish' then
    item_id := (p_input->>'id')::uuid;
    select * into question from public.class_exercise_questions where id = item_id;
    if found then
      if question.class_id <> p_class_id or question.created_by is distinct from p_actor then
        raise exception 'Question identifier is already in use.';
      end if;
      return to_jsonb(question); -- Retry must not restart the timer or advance again.
    end if;
    seconds := (p_input->>'durationSeconds')::integer;
    if seconds is null or seconds < 10 or seconds > 7200 then
      raise exception 'Choose a duration between 10 seconds and 120 minutes.';
    end if;
    update public.class_exercise_questions set stopped_at = stamp
      where id = room.current_question_id and stopped_at is null;
    select coalesce(max(number), 0) + 1 into next_number from public.class_exercise_questions where class_id = p_class_id;
    if next_number > 100 then raise exception 'This class has reached its limit of 100 questions.'; end if;
    insert into public.class_exercise_questions(id, class_id, number, prompt, opened_at, closes_at, created_by)
      values(item_id, p_class_id, next_number, p_input->>'prompt', stamp, stamp + make_interval(secs => seconds), p_actor)
      returning * into question;
    update public.class_exercise_rooms set current_question_id = question.id where class_id = p_class_id;
    return to_jsonb(question);

  elsif p_action = 'submit' then
    -- Defense in depth: only an enrolled student may submit, even through the RPC.
    if not exists (select 1 from public.course_enrollments e join public.course_classes c on c.course_id = e.course_id
      where c.id = p_class_id and e.student_id = p_actor) then
      raise exception 'Enroll in this course to submit an answer.';
    end if;
    item_id := (p_input->>'id')::uuid;
    select * into submission from public.class_exercise_submissions where id = item_id;
    if found then
      if submission.student_id <> p_actor or submission.question_id <> (p_input->>'questionId')::uuid
        or not exists (select 1 from public.class_exercise_questions where id = submission.question_id and class_id = p_class_id) then
        raise exception 'Submission identifier is already in use.';
      end if;
      return to_jsonb(submission);
    end if;
    select * into question from public.class_exercise_questions where id = room.current_question_id;
    if question.id is null or question.id <> (p_input->>'questionId')::uuid
      or question.stopped_at is not null or stamp >= question.closes_at then
      raise exception 'This question is closed. Your answer was not submitted.';
    end if;
    select * into previous from public.class_exercise_submissions
      where question_id = question.id and student_id = p_actor order by attempt desc limit 1;
    if previous.id is not null and previous.status <> 'incorrect' then
      raise exception 'Wait for feedback. Only an incorrect answer can be resubmitted.';
    end if;
    insert into public.class_exercise_submissions(id, question_id, student_id, attempt, answer, submitted_at)
      values(item_id, question.id, p_actor, coalesce(previous.attempt, 0) + 1, p_input->>'answer', stamp)
      returning * into submission;
    return to_jsonb(submission);

  elsif p_action = 'stop' then
    if room.current_question_id is distinct from (p_input->>'questionId')::uuid then
      raise exception 'The question has changed. Refresh before stopping it.';
    end if;
    update public.class_exercise_questions set stopped_at = coalesce(stopped_at, stamp)
      where id = room.current_question_id returning * into question;
    return to_jsonb(question);

  elsif p_action = 'grade' then
    select s.* into submission from public.class_exercise_submissions s
      join public.class_exercise_questions q on q.id = s.question_id
      where s.id = (p_input->>'submissionId')::uuid and q.class_id = p_class_id;
    if submission.id is null then raise exception 'Submission not found.'; end if;
    if exists (select 1 from public.class_exercise_submissions where question_id = submission.question_id
      and student_id = submission.student_id and attempt > submission.attempt) then
      raise exception 'This student has resubmitted. Mark their latest answer.';
    end if;
    if p_input->>'status' not in ('correct', 'incorrect') or p_input->>'status' is null then
      raise exception 'Choose correct or incorrect.';
    end if;
    update public.class_exercise_submissions set status = p_input->>'status', feedback = coalesce(p_input->>'feedback', ''),
      graded_at = stamp, graded_by = p_actor where id = submission.id returning * into submission;
    return to_jsonb(submission);

  elsif p_action = 'claim_announcement' then
    if room.current_question_id is null or room.announced_at is not null or
      room.announcement_claimed_at > stamp - interval '2 minutes' then return 'false'::jsonb; end if;
    update public.class_exercise_rooms set announcement_claimed_at = stamp where class_id = p_class_id;
    return to_jsonb(stamp);
  elsif p_action = 'finish_announcement' then
    update public.class_exercise_rooms set
      announced_at = case when (p_input->>'sent')::boolean then stamp else announced_at end,
      announcement_claimed_at = null
      where class_id = p_class_id and announcement_claimed_at = (p_input->>'claim')::timestamptz;
    return 'true'::jsonb;
  end if;
  raise exception 'Unknown exercise action.';
end;
$$;
revoke all on function public.class_exercise_action(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.class_exercise_action(uuid, uuid, text, jsonb) to service_role;
