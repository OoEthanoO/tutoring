-- Latest Discord sync health snapshot, written by the class-reminders cron and
-- read by the admin panel (site_settings already has RLS with a deny-all
-- policy, so access stays service-role only).
alter table public.site_settings
  add column if not exists discord_sync_status jsonb;
