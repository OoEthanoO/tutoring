-- Add deadline column to events table
alter table public.events add column deadline timestamptz;

-- Set default deadline to starts_at for existing rows
update public.events set deadline = starts_at where deadline is null;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
