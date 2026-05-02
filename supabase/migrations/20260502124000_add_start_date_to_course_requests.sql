alter table public.course_creation_requests
add column start_date date;

-- For existing records, we can leave it null or set a default.
-- Since it's a date, maybe today's date if we want it not null.
-- But for now, let's keep it nullable or set a reasonable default if required.
-- The user didn't specify if it should be required, but usually it is for a request.

update public.course_creation_requests set start_date = current_date where start_date is null;

-- Make it not null
alter table public.course_creation_requests alter column start_date set not null;
