alter table public.app_users
add column strike_count integer not null default 0 check (strike_count >= 0),
add column last_strike_at timestamptz;
