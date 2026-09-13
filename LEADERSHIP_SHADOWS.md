# Leadership Shadows

CEO Shadow and COO Shadow have the website management access of CEO and COO:
courses, requests, recordings, analytics, account management, course needs, and
the other administration tools. Their identities remain separate from CEO/COO.

The founder, CEO, and COO remain protected above both Shadows. A Shadow cannot:

- Change their roles, Pending exemption, junior setting, or strikes.
- Delete or ban their accounts, or impersonate them.
- Transfer their linked Discord account in either direction, or add/revoke
  approved extra Discord accounts on their behalf.
- Assign or create a founder/CEO/COO-level role, including a custom title with
  one of those permission levels. This prevents self-promotion around the rule.

Ordinary profile information and course management remain available. CEO/COO
can still change Shadow assignments. Making someone a student also clears
their custom role, so an old Shadow assignment cannot retain admin access.

`getSessionUser` resolves effective roles for server endpoints and the website.
Both impersonation readers recheck the target on every request, so an old or
manually changed cookie cannot bypass protection. Access-changing endpoints
read the target's current custom-role definition and refuse changes when that
lookup fails. A subordinate custom role never overrides a stored CEO/COO role.

## Discord

The sync gives Shadows matching CEO/COO channel access, including founders and
live class channels, while keeping both Shadow roles below both CEO and COO.
It verifies that order before granting permissions or assigning Shadow roles.
Shadows hold their own leadership role rather than Student or Pending.

Native permissions that can bypass these protections are excluded:
Administrator, Manage Channels, Manage Server, Manage Roles/Permissions,
Manage Webhooks, and voice mute/deafen/move-member powers. Other permissions
follow the corresponding CEO/COO role. Use the protected website controls for
role/access management. Discord role order alone does not constrain channel
or member permission overwrites; see the
[Discord permission hierarchy documentation](https://docs.discord.com/developers/topics/permissions#permission-hierarchy).

## Deployment

Apply `supabase/migrations/20260914010000_elevate_leadership_shadows.sql` before
deploying. It extends the allowed permission levels, upgrades the existing
CEO Shadow definition, and creates or upgrades COO Shadow. Existing assignments
remain intact; assign either title in Manage accounts → Custom Role.

Existing sessions pick up the change on their next request. Discord updates on
the next successful sync. Its bot must be able to position the managed human
roles below its own role; a failure to establish the protected hierarchy stops
that sync before it grants Shadow permissions.
