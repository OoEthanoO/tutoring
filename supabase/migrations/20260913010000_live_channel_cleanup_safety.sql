-- Countdown history is independent of attendance and starts only after class end.
alter table public.discord_live_class_channels
  add column if not exists tutor_absent_since timestamptz,
  add column if not exists recovered_at timestamptz;

comment on column public.discord_live_class_channels.tutor_absent_since is
  'First confirmed tutor absence after class end; cleared on return, unknown presence, or recovery.';

-- Discard clocks left by the previous cleanup rules.
update public.discord_live_class_channels
set empty_since = null, tutor_absent_since = null
where deleted_at is null;

notify pgrst, 'reload schema';
