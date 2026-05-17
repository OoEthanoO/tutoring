-- Add rejection_reason column to course_creation_requests table
alter table public.course_creation_requests
add column rejection_reason text;
