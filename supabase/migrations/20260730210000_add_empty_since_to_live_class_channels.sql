-- Tracks when a live class voice channel was first observed with nobody in it.
-- The cleanup pass only deletes a channel that has looked empty continuously for
-- a while, so a single missed voice-state read (a reconnect, a rate limit, the
-- tutor switching devices) can no longer end a class that is still running.
-- Cleared whenever anyone is seen in the channel.
alter table public.discord_live_class_channels
  add column if not exists empty_since timestamptz;

comment on column public.discord_live_class_channels.empty_since is
  'First tick at which the channel was observed empty; cleared when anyone is present. Deletion requires sustained emptiness.';

notify pgrst, 'reload schema';
