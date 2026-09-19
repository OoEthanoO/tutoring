-- Existing rejected requests remain valid and can be resubmitted without a reason.
-- New rejections require a reason in the management API.
alter table public.course_enrollment_requests
  add column if not exists rejection_reason text;

comment on column public.course_enrollment_requests.rejection_reason is
  'Reason emailed to the applicant on rejection; cleared when they reapply or are approved.';
