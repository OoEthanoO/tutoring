-- Fix existing event deadlines to be exactly 7 days before the earliest date
WITH earliest_dates AS (
    SELECT 
        event_id, 
        MIN(starts_at) as earliest_start
    FROM public.event_dates
    GROUP BY event_id
)
UPDATE public.events e
SET deadline = ed.earliest_start - INTERVAL '7 days'
FROM earliest_dates ed
WHERE e.id = ed.event_id;
