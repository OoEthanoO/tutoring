create table if not exists app_password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_resets_user on app_password_resets(user_id);
create index if not exists idx_password_resets_token on app_password_resets(token_hash);
