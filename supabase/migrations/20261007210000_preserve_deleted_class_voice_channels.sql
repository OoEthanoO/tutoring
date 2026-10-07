-- Discord channels outlive a deleted class. Keep their cleanup records and
-- the last real schedule instead of losing them through ON DELETE CASCADE.
begin;

alter table public.discord_live_class_channels
  alter column class_id drop not null,
  alter column course_id drop not null,
  drop constraint discord_live_class_channels_class_id_fkey,
  drop constraint discord_live_class_channels_course_id_fkey,
  add constraint discord_live_class_channels_class_id_fkey
    foreign key (class_id) references public.course_classes(id) on delete set null,
  add constraint discord_live_class_channels_course_id_fkey
    foreign key (course_id) references public.courses(id) on delete set null;

alter table public.discord_breakout_rooms
  alter column class_id drop not null,
  drop constraint discord_breakout_rooms_class_id_fkey,
  add constraint discord_breakout_rooms_class_id_fkey
    foreign key (class_id) references public.course_classes(id) on delete set null;

-- A schedule may have changed since the last cron tick. Capture it in the same
-- transaction as deletion, then start fresh post-end absence observations.
create or replace function public.preserve_deleted_class_voice_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.discord_live_class_channels
  set starts_at = old.starts_at,
      ends_at = case when old.duration_hours > 0
        then old.starts_at + old.duration_hours * interval '1 hour'
        else 'infinity'::timestamptz end,
      empty_since = null, tutor_absent_since = null
  where class_id = old.id and deleted_at is null;
  return old;
end;
$$;
revoke all on function public.preserve_deleted_class_voice_schedule() from public;
create trigger preserve_deleted_class_voice_schedule
  before delete on public.course_classes
  for each row execute function public.preserve_deleted_class_voice_schedule();

notify pgrst, 'reload schema';
commit;
