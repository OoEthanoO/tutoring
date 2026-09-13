-- Keep shadow identities separate from the protected CEO/COO tier.
begin;
alter table public.custom_roles drop constraint if exists custom_roles_role_level_check;
alter table public.custom_roles add constraint custom_roles_role_level_check
  check (role_level in ('CEO', 'COO', 'CEO Shadow', 'COO Shadow', 'Chief Executive', 'Executive', 'Student'));

insert into public.custom_roles (name, role_level)
values ('CEO Shadow', 'CEO Shadow'), ('COO Shadow', 'COO Shadow')
on conflict (name) do update set role_level = excluded.role_level;

notify pgrst, 'reload schema';
commit;
