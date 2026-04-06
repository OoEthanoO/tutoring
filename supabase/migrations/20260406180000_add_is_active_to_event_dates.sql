-- Add is_active column to event_dates
alter table public.event_dates add column if not exists is_active boolean not null default true;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
