# Approved Discord Accounts

Lets a tutor bring a **second Discord account** into the server for lesson calls
(screen-share/camera tricks that need two clients). Normally the Discord sync
kicks any human server member whose Discord ID is not linked to a website
account; approval is the explicit allowlist for these extra accounts.

## How to approve an account

1. Go to **Admin → Manage accounts → Approved Discord tab** (founder only).
2. Enter the extra account's **Discord user ID** (17–20 digits; in Discord:
   Settings → Advanced → Developer Mode, then right-click the user → Copy User ID).
3. Pick the **tutor** who owns the account (required) and an optional label.
4. Have the tutor join the server with that account via the server invite shown
   in the panel. The Status column shows **In server / Not joined yet**.

## What an approved account gets

- **Stays in the server** — the sync's kick pass skips it.
- **The owner's course roles** — mirrored on every sync for courses the owner
  teaches (or is enrolled in), so it sees the same course text channels. Roles
  are removed when the course ends, same as the main account.
- **Live lesson voice channels** — the class-reminders cron adds it to each of
  the owner's live class channels with the same permissions as the owner,
  including the tutor-only early-access window 15 minutes before start.
- No base roles (Student/Executive/…), no nickname management, no join/leave
  notifications — those only apply to website-linked accounts.

## Invariants and lifecycle

- A Discord ID is **either** linked to a website account **or** an approved
  extra account, never both. Enforced in both directions: the admin approve API
  rejects IDs already linked to a website account, and the Discord OAuth
  connect flow rejects IDs that are approved (`?discord=account_reserved`).
- Removing an approval (or deleting the owner's website account, which cascades)
  kicks the account on the next sync.

## Storage and deploy notes

- Table: `approved_discord_accounts` (migration
  `supabase/migrations/20260719120000_create_approved_discord_accounts.sql`),
  RLS deny-all; accessed only through the service role.
- The migration must be applied **before** deploying code that references the
  table: `runDiscordSync` intentionally aborts when the table is missing
  (running without the allowlist would kick every approved account), and the
  Discord OAuth connect flow fails closed for the same reason.

## Troubleshooting

- **Sync health**: Admin → Manage accounts → Admin Tools shows the last sync
  run, whether it succeeded, and its errors (persisted by the cron to
  `site_settings.discord_sync_status`). The founders channel gets a ping when
  sync starts or stops failing.
- **Approved account got kicked**: check that its approval row still exists
  (deleting the owner's website account cascades) and that the sync isn't
  aborting (see sync health above).
