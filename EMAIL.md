# Email

YanLearn sends every email over SMTP through **SMTP2GO** (free plan), as
`YanLearn <learn@notifications.ethanyanxu.com>`. History:

- Until 2026-11-24, the Resend API.
- 2026-11-24 to 2026-11-26, the organization's Gmail account over SMTP. Its
  mail kept landing in recipients' Spam (password resets included), so it was
  replaced.
- Since 2026-11-26, SMTP2GO. It was chosen because its free plan adds no
  "sent with" footer or branding to emails; Brevo and Mailjet do.

A mail server on finprint-host itself cannot work: the home connection
blocks outgoing port 25 (tested 2026-11-24 against Gmail's, Outlook's and
Yahoo's mail servers), and the big providers refuse or junk mail from home
addresses anyway. Port 587 is open, which is what this uses.

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
- `sent` means SMTP2GO accepted the email. Whether it was then delivered,
  bounced or held is in SMTP2GO's dashboard (Reports → Activity), not in
  `email_log`.
- The database-backup alert (`deploy/windows/backup-db.ps1`) sends through
  the same settings with .NET's SMTP client.

## Settings

In `secrets\production.json` on finprint-host (and `.env.local` for local
development):

| Setting | Production value |
|---|---|
| `SMTP_HOST` | `mail.smtp2go.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | the SMTP2GO SMTP user (Sending → SMTP Users) |
| `SMTP_PASSWORD` | that SMTP user's password |
| `EMAIL_FROM` | `YanLearn <learn@notifications.ethanyanxu.com>` (required: the SMTP2GO username is not an address) |

The SMTP2GO account belongs to the organization's Gmail. Its verified sender
domain is `notifications.ethanyanxu.com`, through three DNS-only CNAMEs in
Cloudflare: `em1272564` → `return.smtp2go.net`, `s1272564._domainkey` →
`dkim.smtp2go.net` (DKIM), and `link` → `track.smtp2go.net`. Deleting them
stops delivery. A new SMTP user may be refused (`535 Incorrect authentication
data`) for a minute or two after it is created.

To change the login, run `C:\Users\ethan\yanlearn-check\set-smtp2go.ps1` over `ssh -t` (it asks for the
username and a hidden password and keeps `production.json.before-smtp2go`),
then deploy a new commit. The running site only reads the settings when it
starts, and `ops\deploy.ps1` skips a commit that is already live.

Falling back to Gmail: remove `SMTP_HOST` and `EMAIL_FROM`, and set
`SMTP_USER` to the organization's Gmail address and `SMTP_PASSWORD` to a
Google app password. The code still defaults to `smtp.gmail.com`.

The deploy refuses a release without `SMTP_USER` and `SMTP_PASSWORD`, and the
new release's own start-up check fails, so existing traffic stays on the old
release until they are set.

## Limits

SMTP2GO's free plan allows 1,000 emails a month and 200 a day. Once the
monthly limit is reached, every new email is rejected (not queued) until the
month resets, password resets included, and each is logged as `failed`.
YanLearn's log showed about 10 emails and 25 recipients a day in late
November 2026. If SMTP2GO counts each recipient, that is close to the limit,
so check the quota on SMTP2GO's dashboard and upgrade before it runs out.
Keep group emails in Bcc and avoid mass emails to every account.
