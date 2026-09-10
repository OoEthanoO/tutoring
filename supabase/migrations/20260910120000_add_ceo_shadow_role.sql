-- CEO Shadow is an organization title with normal Executive permissions.
-- It deliberately does not inherit CEO/founder authority. The Discord sync
-- gives an assigned user the CEO Shadow role alongside their mutually
-- exclusive Executive/Pending standing.
insert into public.custom_roles (name, role_level)
values ('CEO Shadow', 'Executive')
on conflict (name) do update
  set role_level = excluded.role_level;

notify pgrst, 'reload schema';

