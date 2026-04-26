create table if not exists public.banned_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.banned_emails enable row level security;

create or replace function delete_user_on_ban() returns trigger as $$
begin
  delete from public.app_users where email = NEW.email;
  return NEW;
end;
$$ language plpgsql;

create trigger trigger_delete_user_on_ban
after insert on public.banned_emails
for each row execute function delete_user_on_ban();
