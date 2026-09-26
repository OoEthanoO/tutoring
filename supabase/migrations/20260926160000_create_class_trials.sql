-- One independent guest identity per scheduled class, never a tutor alias.
create table public.class_trials (
  id uuid primary key default gen_random_uuid(),
  -- Keep the identity tombstone if a class is deleted, so sync can revoke
  -- its member overwrites even when the live-channel registry is gone.
  class_id uuid references public.course_classes(id) on delete set null,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  student_name text not null check (length(btrim(student_name)) between 1 and 100),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (class_id, discord_user_id)
);
create index class_trials_discord_idx on public.class_trials(discord_user_id);
alter table public.class_trials enable row level security;
create policy "Deny all access" on public.class_trials for all using (false);

-- Serialize both identity types, including concurrent approvals/conversions.
create function public.guard_trial_discord_identity() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.discord_user_id, 0));
  if tg_table_name = 'class_trials' then
    if new.revoked_at is null and exists (
      select 1 from public.course_classes c join public.courses co on co.id = c.course_id
      where c.id = new.class_id and co.deleted_at is null and not co.is_completed
        and c.starts_at + (round(c.duration_hours * 60) + 30) * interval '1 minute' > clock_timestamp()
    ) and exists (
      select 1 from public.approved_discord_accounts where discord_user_id = new.discord_user_id
    ) then raise exception 'Remove or replace the tutor-linked approval before adding a trial.' using errcode = '23514'; end if;
  else
    if exists (
      select 1 from public.class_trials t
      join public.course_classes c on c.id = t.class_id
      join public.courses co on co.id = c.course_id
      where t.discord_user_id = new.discord_user_id and t.revoked_at is null
        and co.deleted_at is null and not co.is_completed
        and c.starts_at + (round(c.duration_hours * 60) + 30) * interval '1 minute' > clock_timestamp()
    ) then raise exception 'This Discord account has a trial booking. Revoke its trials before making it a tutor extra account.' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger class_trials_identity before insert or update on public.class_trials
  for each row execute function public.guard_trial_discord_identity();
create trigger approved_accounts_trial_identity before insert or update on public.approved_discord_accounts
  for each row execute function public.guard_trial_discord_identity();

-- Management authorization/protected-owner checks happen in the API. The
-- expected owner prevents a concurrent ownership change bypassing that check.
create function public.save_class_trial(
  p_class_id uuid, p_discord_user_id text, p_student_name text, p_actor_id uuid,
  p_replace_owner_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lesson public.course_classes;
  owner_id uuid;
  trial_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_discord_user_id, 0));
  select * into lesson from public.course_classes where id = p_class_id for update;
  if not found or lesson.starts_at + (round(lesson.duration_hours * 60) + 30) * interval '1 minute' <= clock_timestamp()
    or not exists (select 1 from public.courses where id = lesson.course_id and deleted_at is null and not is_completed)
  then raise exception 'Choose an upcoming or currently running class.' using errcode = '23514'; end if;
  -- The course chat also has a 100-overwrite limit. Serialize reservations
  -- across its classes and leave room for the bot/staff/role entries.
  perform pg_advisory_xact_lock(hashtextextended(lesson.course_id::text, 1));
  if (select count(distinct t.discord_user_id) from public.class_trials t
      join public.course_classes c on c.id = t.class_id
      where c.course_id = lesson.course_id and t.revoked_at is null and t.discord_user_id <> p_discord_user_id
        and c.starts_at + (round(c.duration_hours * 60) + 30) * interval '1 minute' > clock_timestamp()) >= 80
  then raise exception 'This course already has 80 trial students booked.' using errcode = '23514'; end if;
  select owner_user_id into owner_id from public.approved_discord_accounts where discord_user_id = p_discord_user_id for update;
  if owner_id is not null then
    if p_replace_owner_id is distinct from owner_id
    then raise exception 'Confirm replacement of the existing tutor-linked approval.' using errcode = '23514'; end if;
    delete from public.approved_discord_accounts where discord_user_id = p_discord_user_id;
  end if;
  insert into public.class_trials(class_id, discord_user_id, student_name, created_by)
    values(p_class_id, p_discord_user_id, btrim(p_student_name), p_actor_id)
    on conflict (class_id, discord_user_id) do update set
      student_name = excluded.student_name, revoked_at = null, created_by = excluded.created_by,
      created_at = clock_timestamp()
    returning id into trial_id;
  return trial_id;
end;
$$;
revoke all on function public.save_class_trial(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_class_trial(uuid, text, text, uuid, uuid) to service_role;
