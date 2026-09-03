# YanLearn Recorder

Desktop app (macOS + Windows) that records tutors' classes and uploads them to
YanLearn, plus the website side that stores, protects, serves, and expires those
recordings. **Mandatory for every class from 2026‑09‑09.**

> Status (2026‑09‑02): everything below was written without a compiler or a
> test run available on the authoring machine — no Node, Rust, or Swift were
> installed. Expect the first `tsc`/`vitest`/`cargo` runs to surface small
> errors (API signatures in the `wasapi` crate and Tauri 2 are the likeliest).
> Nothing has been deployed or built yet.

## What the tutor experiences

1. Install the app (GitHub release), sign in with their YanLearn tutor account.
   The app lives in the tray / menu bar and stays signed in.
2. If they have more than one display, microphone, or speaker, the app makes
   them choose which to record (with an "Identify" flash on each display).
3. From **15 min before** a class the app pre‑arms; from **5 min before** it is
   locked — closing the window only hides it, and Quit/Cmd+Q are refused until
   the recording has been uploaded.
4. At the start time recording begins automatically **while the tutor is in the
   class's live Discord voice channel**. Leaving the call pauses, rejoining
   resumes (within one poll, ~2 s). If the app is opened late it starts
   recording immediately (subject to being in the call).
5. Pause hotkey **Ctrl+Alt+P / ⌘+Option+P**:
   * pressed while in the call → *manual pause*, with a large centred banner
     until they press it again;
   * pressed while outside the call → *forced pause*: joining the call does
     **not** resume recording until they press it again.
6. A small click‑through overlay pill (bottom‑right of the recorded display)
   always shows REC / paused / force‑paused / armed / uploading. It is
   content‑protected, so it does not appear in Discord screen shares (or, on
   Windows, in the recording itself).
7. After the scheduled end, once the tutor leaves the call the app asks "Is the
   class done?". **Yes** → upload now. **No** → wait; when the cron deletes the
   live voice channel the app uploads whatever it has, unconditionally.
8. Students enrolled in the course (and the tutor / founders) can watch the
   recording under **My classes → Class recordings** for 7 days. The player has
   no download control and the stream refuses non‑media requests.

## Quality profile (decision)

Chosen for legible text at the lowest CPU cost on low‑end laptops that are also
running Discord:

| Setting | Value | Why |
| --- | --- | --- |
| Resolution | display scaled to **720p** (1080p if the display is above 1440p) | Discord shares are 720p anyway; 14 px text stays readable; 4K → 1080p keeps a 2× downscale |
| Frame rate | **10 fps** | slides/code/whiteboard content; halves encode cost vs 20 fps |
| Video codec | H.264, `libx264 superfast crf 26` (or NVENC/QSV/AMF/VideoToolbox when present, ~1 Mbps) | plays in every browser without transcoding; hardware path falls back automatically |
| Audio | mic + system audio mixed, AAC 64 kbps mono | speech only |
| Container | fragmented MP4 per segment → stitched MP4 with `faststart` | a crash leaves playable segments |

≈ 60–120 MB per hour. Storage cost is negligible; egress (students watching)
dominates, which is another reason not to go higher.

Capture backends: Windows uses Desktop Duplication (`ddagrab`) when there is a
single display and GDI region capture (`gdigrab`) when the tutor picked one of
several; macOS uses AVFoundation ("Capture screen N"). System audio: Windows
WASAPI loopback of the chosen speaker (in Rust, streamed to ffmpeg over a
loopback TCP socket, silence‑padded against the wall clock); macOS a bundled
ScreenCaptureKit helper (`recorder/sysaudio/main.swift`, macOS 13+), which
captures the mix regardless of output device — so macOS has no speaker choice.

## Architecture

```
recorder/                      Tauri 2 app ("YanLearn Recorder")
  src/main.js                  state machine + UI (vanilla JS, no bundler)
  src/overlay.html             the always-on-top status overlay / display identify flash
  src-tauri/src/lib.rs         tray, quit lock, hotkey, settings/files, command wiring
  src-tauri/src/capture.rs     ffmpeg sidecar: device probe, args, start/stop, concat
  src-tauri/src/sysaudio.rs    system audio feeder (WASAPI loopback / SCK helper) → TCP → ffmpeg
  src-tauri/src/overlay.rs     overlay + identify windows, display list
  src-tauri/src/upload.rs      streaming PUT to the signed storage URL
  sysaudio/main.swift          macOS ScreenCaptureKit system-audio helper
  scripts/fetch-ffmpeg.mjs     downloads the static ffmpeg sidecar per target
.github/workflows/recorder-release.yml   builds mac arm64 / mac x64 / win x64 on `recorder-v*` tags

src/lib/recorderPolicy.ts      the rules (phases, lock, compliance, 7-day expiry) — unit tested
src/lib/recordings.ts          access checks, playback tokens, expiry sweep, storage paths
src/lib/recordingStorage.ts    S3-compatible bucket (R2 / B2 free tier): presigned PUT/GET, HEAD, delete
src/lib/recorderAuth.ts        bearer-token auth for the app (same app_sessions table)
src/lib/discordVoice.ts        no-retry voice-state lookup for the tick
src/app/api/recorder/auth/{login,logout}         app sign-in (tutors only)
src/app/api/recorder/tick                        heartbeat + "which class / what phase / in call?"
src/app/api/recorder/recordings                  create row + signed upload URL
src/app/api/recorder/recordings/[id]/complete    verify object, mark ready, start 7-day clock
src/app/api/recordings                           list what the signed-in user may watch
src/app/api/recordings/[id]/playback-token       per-viewer HMAC token (6 h)
src/app/api/recordings/[id]/stream               token check → 302 to a 2-minute presigned URL (or range proxy)
src/components/ClassRecordings.tsx               list + no-download player (in My classes)
src/components/RecorderNotice.tsx                tutor banner; Help tab has the full guide
supabase/migrations/20260902120000_create_class_recordings.sql
```

### Presence detection ("resume immediately, minimal resources")

There is no persistent Discord gateway process in this deployment (Vercel), so
push notifications of voice state are not available. Instead the app polls
`/api/recorder/tick` every **2 s** only while a class is near/active (every
30 s otherwise); the tick reads the tutor's voice state (plus approved extra
accounts) from Discord's REST `voice-states` endpoint without retries. One tiny
JSON request every 2 s is negligible on the client; on the server it is one or
two Discord calls per active tutor every 2 s. If Discord rate‑limits, the tick
answers "unknown" and the app keeps its current state. Resume latency is the
poll interval plus ffmpeg spin‑up (~0.5 s). If a gateway worker is ever added,
the tick can push over SSE with the same client contract.

### Locking and release

`recorderPhase` (server) → `pre_arm | armed | live | after_end | null`. The
client is locked from `armed` until it has nothing left to upload. A class is
released when a ready recording exists or the client reports `finished`
(uploaded / no_recording / abandoned). Safety valve: 3 h after the end the
server stops reporting the class so nobody is locked forever if the live
channel never existed (e.g. legacy Zoom courses).

### Non‑downloadable playback

The bucket is private and never listed. The player requests a playback token
bound to (viewer, recording, 6 h); the stream endpoint validates it on every
byte‑range request (browsers re-request the original URL for each range and
follow the redirect afresh), rejects requests whose `Sec-Fetch-Dest` is not a
media element (blocks "open in new tab"/"save link"), and then 302s to a
presigned bucket URL that expires in **2 minutes** and is served
`Content-Disposition: inline`, `no-store`. Bytes flow straight from the bucket,
so watching costs no Vercel bandwidth. `RECORDINGS_STREAM_MODE=proxy` instead
streams ≤4 MB chunks through the function and never exposes a bucket URL, at
the cost of Vercel bandwidth.
The `<video>` has `controlsList="nodownload"`, no PiP, no context menu. None of
this defeats a screen recorder; it removes every download affordance and makes
links useless to third parties, and the file is gone after 7 days.

### Compliance

`recorder_class_sessions.first_seen_at` is when the tutor's app first reported
the class. The class‑reminders cron, in the tick containing each class start
(only for classes with a live‑channel row, only from 2026‑09‑09), posts to the
executives channel when the recorder was missing or opened <5 min early — once
per class (`class_reminder_logs` type `recorder_not_open`). The same cron runs
`expireClassRecordings` (deletes objects past `expires_at`, marks abandoned
uploads failed).

## Deploying the website side

1. **Apply the migration first** (creates the 3 tables).
2. **Create a free S3‑compatible bucket** — Supabase Storage is not used
   (its Free tier caps files at 50 MB and the project at 1 GB). Either:
   * **Cloudflare R2**: 10 GB storage and unlimited egress free; needs a
     payment method on file (not charged under the free limits). Create a
     private bucket, an API token with Object Read & Write, and use endpoint
     `https://<account-id>.r2.cloudflarestorage.com`, region `auto`.
   * **Backblaze B2**: 10 GB storage free, egress free up to 3× stored per
     month, no card needed. Create a private bucket and an application key,
     endpoint `https://s3.<region>.backblazeb2.com`, region e.g. `us-west-004`.
   Then set on Vercel: `RECORDINGS_S3_ENDPOINT`, `RECORDINGS_S3_BUCKET`,
   `RECORDINGS_S3_REGION`, `RECORDINGS_S3_ACCESS_KEY_ID`,
   `RECORDINGS_S3_SECRET_ACCESS_KEY`. 10 GB with 7‑day retention is roughly
   100 class‑hours per rolling week at the recorder's quality.
3. Optional env: `RECORDING_TOKEN_SECRET` (playback‑token HMAC key; falls back
   to the service‑role key); `RECORDINGS_STREAM_MODE=proxy` (see above).
   Discord vars are the existing ones.
4. `npm install` (adds `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`),
   then push to `master` and run `npm test` / `tsc` — see the status note above.

## Building the app

CI: push a tag `recorder-v0.1.0` (version in `recorder/package.json` and
`recorder/src-tauri/tauri.conf.json`) → GitHub release with `.dmg` (Apple
Silicon and Intel) and `.msi` / `-setup.exe`. The Help tab and tutor banner
link to `releases/latest`.

Locally (needs Node 20, Rust stable, and on macOS Xcode CLT):

```bash
cd recorder && npm install && node scripts/fetch-ffmpeg.mjs && npm run icons && npm run dev
```

macOS also needs the helper: `swiftc -O -target arm64-apple-macos13.0 -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation sysaudio/main.swift -o src-tauri/binaries/sysaudio-aarch64-apple-darwin`.

Builds are **unsigned**. macOS shows "unidentified developer" (right‑click →
Open, or add an Apple Developer ID cert + notarization to the workflow);
Windows SmartScreen shows "More info → Run anyway". Signing is the main thing
to add before rolling out to all tutors.

## Known limitations / follow‑ups

* Not compiled or run yet (see the status note). Verify the `wasapi` 0.13 API
  (`initialize_client`, `read_from_device_to_deque`), Tauri 2 builder method
  names (`show_menu_on_left_click`, `AppHandle::available_monitors`), and the
  macOS `ffmpeg.martin-riedl.de` download URLs in `fetch-ffmpeg.mjs`.
* macOS: the overlay is `NSWindowSharingNone` (hidden from Discord), but
  AVFoundation screen capture may still include it in the recording; if so,
  move the pill to a non‑recorded display or accept the small pill.
* macOS system audio needs macOS 13+ and the Screen Recording permission (on
  macOS 15 also "System Audio Recording"). Without it, recording proceeds with
  microphone only and the overlay says "system audio off".
* Discord voice lookups from the tick are per‑route rate limited; with many
  simultaneous classes consider caching the last lookup in
  `recorder_class_sessions` for ~1.5 s.
* In the default redirect stream mode a presigned bucket URL is exposed to the
  viewer's browser for 2 minutes at a time; someone determined could copy it
  and `curl` the file within that window. Proxy mode closes that at the cost
  of Vercel bandwidth.
* Only the course's `created_by` tutor is checked for compliance; a co‑tutor's
  recorder also counts for release/upload but not for the warning.
* ffmpeg GPL static builds are redistributed; keep the ffmpeg licence notice
  with the app if it is ever distributed outside the organization.
