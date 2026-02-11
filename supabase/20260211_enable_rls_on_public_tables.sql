-- One-time patch for existing databases:
-- enable RLS on public tables flagged by Supabase database linter.

alter table if exists public.class_reminder_logs enable row level security;
alter table if exists public.site_settings enable row level security;
alter table if exists public.app_sessions enable row level security;
alter table if exists public.app_users enable row level security;
alter table if exists public.app_email_verifications enable row level security;
alter table if exists public.feedback_submissions enable row level security;
