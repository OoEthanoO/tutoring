# Email

Since November 2026 YanLearn sends every email over SMTP as the
organization's Gmail account, instead of through the Resend API. Gmail is
free and needs no extra account; the families already know the address, and
their replies land in that inbox.

A mail server on finprint-host itself cannot work: the home connection
blocks outgoing port 25 (tested 2026-11-24 against Gmail's, Outlook's and
Yahoo's mail servers), and the big providers refuse or junk mail from home
addresses anyway. Port 587 to `smtp.gmail.com` is open, which is what this
uses.

## How it works

- `src/lib/mailer.ts` owns sending. `deliverEmail({ to, bcc, subject, html,
  attachments })` signs in to the SMTP server (nodemailer, one pooled
  connection), retries a temporary refusal (a 4xx reply or a dropped
  connection) up to three times, and fails at once on a permanent one (wrong
  password, the daily limit, a refused address).
- `src/lib/notificationsServer.ts` wraps it as `sendEmail` (one recipient)
  and `sendBccEmail` (one identical email to many people, split into
  messages of at most 50 recipients, To the organization's inbox, everyone
  else in Bcc). The class-reminders cron, the auth routes and
  `api/admin/users` all go through these.
- Every send, sent or failed, is a row in `email_log` (migration
  `20261124120000_email_log.sql`): from, To, Bcc, subject, HTML, attachment
  file names (not their contents), status, the server's error, message id.
  Admin → Emails (`api/admin/emails`, `EmailHistoryMenu.tsx`) lists it, newest
  first, for the founder, CEO and COO. Emails sent through Resend before the
  switch are not in it.
- `sent` means Gmail accepted the email. A bounce that comes later, such as a
  mistyped address, arrives in the account's inbox as a "Mail Delivery
  Subsystem" email.
- The database-backup alert (`deploy/windows/backup-db.ps1`) sends through
  the same settings with .NET's SMTP client.

## Settings

In `secrets\production.json` on finprint-host (and `.env.local` for local
development):

| Setting | Value |
|---|---|
| `SMTP_USER` | the organization's Gmail address (required) |
| `SMTP_PASSWORD` | a Google **app password** for that account (required) |
| `EMAIL_FROM` | optional; defaults to `YanLearn <SMTP_USER>`. Gmail only keeps a different address here if it is a verified "Send mail as" alias of the account. |
| `SMTP_HOST`, `SMTP_PORT` | optional; default `smtp.gmail.com` and `587` |

Making the app password: the account needs 2-Step Verification (Google
Account → Security). Then Google Account → Security → App passwords, name it
"YanLearn", and copy the 16 letters. Google shows them in groups of four;
the spaces may stay, the site removes them for Gmail. Never use the account's
real password, and never put a dummy password in a copy of the settings
(the trial restore and the smoke test leave SMTP empty or point it at a
closed local port): each wrong password is a failed sign-in Google counts
against the account.

The deploy refuses a release without `SMTP_USER` and `SMTP_PASSWORD`, and the
new release's own start-up check fails, so existing traffic stays on the old
release until they are set.

## Limits

A personal Gmail account may send to roughly 500 recipients a day; Google
counts every To and Bcc address. YanLearn sent about 13 emails a day in
November 2026, most to one class. Over the limit, Gmail refuses every email
for up to a day (`550 5.4.5 Daily user sending limit exceeded`), password
resets included, and each refusal is logged as `failed`. So keep group
emails in Bcc and avoid mass emails to every account on busy days.

## Going live (order matters)

1. Make the app password (above) and add `SMTP_USER` and `SMTP_PASSWORD` to
   `secrets\production.json`. The site keeps sending through Resend until
   step 3.
2. Apply `supabase\migrations\20261124120000_email_log.sql` with
   `ops\apply-migration.ps1`.
3. Push to `master`. The first emails after the deploy show in Admin →
   Emails with status `sent`, and a copy of each group email reaches the
   organization's inbox.
4. Once emails are flowing, `RESEND_API_KEY` and `RESEND_FROM` may be
   removed from `secrets\production.json`. Keep the Resend account itself:
   STROJ also sends through it.

Rolling back with `ops\rollback.ps1` returns to the Resend release; it works
as long as the Resend settings are still in `secrets\production.json`.
