-- Breakout rooms: extra voice channels a tutor opens during a class so students
-- can work in small groups. They sit in the Live category beside the class's
-- own channel, copy its access, and count as "in the class" for attendance,
-- tutor presence warnings, live-channel cleanup and YanLearn Recorder.
--
-- A room is deleted when the tutor closes it, or with its class's live channel;
-- the class-reminders cron sweeps any that outlive their class.

create table if not exists public.discord_breakout_rooms (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  -- The class's live channel when the room was opened; everyone is moved back
  -- there when the rooms close.
  live_channel_id text not null,
  discord_channel_id text not null unique,
  -- Shown as "Room 1", "Room 2", ...
  number integer not null,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists discord_breakout_rooms_open_idx
  on public.discord_breakout_rooms (class_id)
  where deleted_at is null;

alter table public.discord_breakout_rooms enable row level security;

create policy "Deny all access" on public.discord_breakout_rooms for all using (false);

notify pgrst, 'reload schema';
