-- Bounded, redacted snapshots. These are diagnostics, not recording contents.
-- The existing recorder-session identity owns each report; clients cannot read
-- this table. Only authenticated server routes can write/read it.
create table public.recorder_diagnostics (
  tutor_id uuid not null,
  device_id text not null,
  report jsonb not null check (
    jsonb_typeof(report) = 'object' and octet_length(report::text) <= 196608
  ),
  received_at timestamptz not null default now(),
  primary key (tutor_id, device_id),
  foreign key (tutor_id, device_id) references public.recorder_sessions(tutor_id, device_id) on delete cascade
);
create index recorder_diagnostics_received_at_idx on public.recorder_diagnostics(received_at);
alter table public.recorder_diagnostics enable row level security;
create policy "Deny all access" on public.recorder_diagnostics for all using (false) with check (false);
