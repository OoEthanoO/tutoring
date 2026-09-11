-- A completed upload announces itself in its course's Discord channel. Keeping
-- the timestamp on the recording lets the reminder cron retry a temporary
-- Discord failure without re-uploading the video or pinging successful uploads twice.
alter table public.class_recordings
  add column if not exists discord_announced_at timestamptz;

comment on column public.class_recordings.discord_announced_at is
  'When YanBot announced that this recording was ready in its course channel.';
