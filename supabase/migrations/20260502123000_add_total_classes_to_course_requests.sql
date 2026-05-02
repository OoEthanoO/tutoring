alter table public.course_creation_requests
add column total_classes integer;

-- Update existing records if any (default to 1 or something sensible)
update public.course_creation_requests set total_classes = 1 where total_classes is null;

-- Now make it not null
alter table public.course_creation_requests alter column total_classes set not null;
