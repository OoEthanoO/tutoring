create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  options jsonb not null default '[]'::jsonb,
  deadline timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null
);

create table if not exists public.form_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  response text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(form_id, user_id)
);

alter table public.forms enable row level security;
alter table public.form_responses enable row level security;
