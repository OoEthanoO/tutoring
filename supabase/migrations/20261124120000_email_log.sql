-- Email log (November 2026). See EMAIL.md.
--
-- YanLearn now sends through SMTP (the organization's Gmail account) instead
-- of the Resend API. Resend kept a history of every email, which Admin ->
-- Emails read; SMTP keeps none, so src/lib/mailer.ts records each send here
-- and the Emails page reads this table instead.
--
-- status is the outcome of the hand-off to the mail server: 'sent' means the
-- server accepted the email, 'failed' that every attempt was refused. A
-- bounce that comes later (for example a mistyped address) arrives in the
-- sending account's inbox as a "Mail Delivery Subsystem" email, not here.

create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  from_address text not null default '',
  to_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  subject text not null default '',
  html text,
  -- Only the file names: attachment contents are not kept.
  attachment_names text[] not null default '{}',
  status text not null check (status in ('sent', 'failed')),
  error text,
  message_id text
);

create index if not exists email_log_created_at_idx on public.email_log (created_at desc, id desc);

alter table public.email_log enable row level security;
drop policy if exists "Deny all access" on public.email_log;
create policy "Deny all access" on public.email_log for all using (false);

comment on table public.email_log is
  'Every email the site sent (or failed to send) through SMTP, newest first in Admin -> Emails. Service role only; see EMAIL.md.';
