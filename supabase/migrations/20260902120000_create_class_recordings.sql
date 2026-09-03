-- YanLearn Recorder: class recordings uploaded by the desktop app, plus the
-- heartbeat tables that let the server know a tutor's recorder is open.
--
-- Recordings live in a private S3-compatible bucket (Cloudflare R2 / Backblaze
-- B2 free tiers — see src/lib/recordingStorage.ts), never in Supabase Storage,
-- and are only ever served through /api/recordings/[id]/stream, which checks
-- enrollment.
-- Every recording expires 7 days after upload (see src/lib/recorderPolicy.ts);
-- the class-reminders cron deletes the storage object and marks the row.

create table if not exists public.class_recordings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  tutor_id uuid not null references public.app_users(id) on delete cascade,
  -- uploading | ready | failed | expired
  status text not null default 'uploading',
  storage_bucket text not null default 'class-recordings',
  storage_path text not null unique,
  content_type text not null default 'video/mp4',
  size_bytes bigint,
  duration_seconds integer,
  recording_started_at timestamptz,
  recording_ended_at timestamptz,
  -- tutor_confirmed | channel_deleted | recovered
  upload_reason text,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz
);

create index if not exists class_recordings_class_id_idx on public.class_recordings (class_id);
create index if not exists class_recordings_course_id_idx on public.class_recordings (course_id);
create index if not exists class_recordings_expires_at_idx on public.class_recordings (expires_at)
  where status = 'ready';

alter table public.class_recordings enable row level security;
create policy "Deny all access" on public.class_recordings for all using (false);

-- One row per signed-in recorder install. `last_seen_at` is the heartbeat.
create table if not exists public.recorder_sessions (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.app_users(id) on delete cascade,
  device_id text not null,
  device_name text,
  platform text,
  app_version text,
  -- Free-form state the client last reported (idle, armed, recording, ...).
  last_state text,
  current_class_id uuid references public.course_classes(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tutor_id, device_id)
);

create index if not exists recorder_sessions_last_seen_idx on public.recorder_sessions (last_seen_at);

alter table public.recorder_sessions enable row level security;
create policy "Deny all access" on public.recorder_sessions for all using (false);

-- One row per (class, tutor): when the recorder first saw this class (used to
-- check the "open 5 minutes before the start" rule) and whether it is finished
-- with it (uploaded, or nothing to upload).
create table if not exists public.recorder_class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  tutor_id uuid not null references public.app_users(id) on delete cascade,
  device_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  recording_started_at timestamptz,
  last_state text,
  finished_at timestamptz,
  -- uploaded | no_recording | abandoned
  finish_reason text,
  unique (class_id, tutor_id)
);

create index if not exists recorder_class_sessions_class_id_idx on public.recorder_class_sessions (class_id);

alter table public.recorder_class_sessions enable row level security;
create policy "Deny all access" on public.recorder_class_sessions for all using (false);

notify pgrst, 'reload schema';
