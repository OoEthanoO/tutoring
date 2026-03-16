-- Make event_id nullable in event_responses since we now use event_date_id
alter table public.event_responses alter column event_id drop not null;

-- Optionally, we could drop it, but keeping it for now in case of any drift
-- alter table public.event_responses drop column event_id;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
