-- Add missing columns to course_creation_requests
alter table public.course_creation_requests 
  add column if not exists total_classes integer default 1,
  add column if not exists start_date text;

-- Update the policy to allow users to update their own requests
drop policy if exists "founders can update course requests" on public.course_creation_requests;

create policy "founders can update course requests" on public.course_creation_requests
  for update
  using (
    exists (
      select 1 from public.app_users
      where app_users.id = auth.uid()
      and app_users.role = 'founder'
    )
  );

create policy "users can update their own course requests" on public.course_creation_requests
  for update
  using (auth.uid() = created_by);
