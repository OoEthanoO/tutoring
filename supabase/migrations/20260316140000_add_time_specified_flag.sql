-- Add is_time_specified to event_dates
alter table public.event_dates add column is_time_specified boolean not null default true;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
