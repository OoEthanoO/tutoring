# YanLearn Recorder

Desktop app (macOS + Windows) that records tutors' classes and uploads them to
YanLearn, plus the website side that stores, protects, serves, and expires those
recordings. **Mandatory for every class from 2026‑09‑09.**

> Status (2026‑09‑04): `recorder-v0.1.0` was built and released on 2026‑09‑03 —
> the workflow is green on all three targets, so the app compiles and bundles.
> What is still unproven is everything that only shows up at runtime (the
> `wasapi` loopback, the macOS helper, a real class end to end) and the
> automatic updater added in 0.2.0, which by its nature cannot be exercised
> until a second release exists to update *to*.

## What the tutor experiences

1. Install the app (GitHub release), sign in with their YanLearn tutor account.
   The app lives in the tray / menu bar, stays signed in, and updates itself
   between classes — there is never a second download.
2. If they have more than one display, microphone, or speaker, the app makes
   them choose which to record (with an "Identify" flash on each display).
   They can also switch from recording the whole display to recording only
   the windows they tick — see "Recording windows instead of the whole
   display".
3. From **15 min before** a class the app pre‑arms; from **5 min before** it is
   locked — closing the window only hides it, and Quit/Cmd+Q are refused until
   the recording has been uploaded.
4. At the start time recording begins automatically **while the tutor is in the
   class's live Discord voice channel**. Leaving the call pauses, rejoining
   resumes (within one poll, ~2 s). If the app is opened late it starts
   recording immediately (subject to being in the call).
5. Mute hotkey **Ctrl+Alt+M / ⌘+Option+M** drops their microphone from the
   recording (not from Discord) until they press it again, with a banner
   saying so throughout.
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
  src/windowmath.js            window matching + crop maths (pure, unit tested)
  src/overlay.html             the always-on-top status overlay / display identify flash
  src-tauri/src/lib.rs         tray, quit lock, hotkey, settings/files, command wiring
  src-tauri/src/capture.rs     ffmpeg sidecar: device probe, args, start/stop, concat
  src-tauri/src/sysaudio.rs    system audio feeder (WASAPI loopback / SCK helper) → TCP → ffmpeg
  src-tauri/src/overlay.rs     overlay + identify windows, display list
  src-tauri/src/upload.rs      streaming PUT to the signed storage URL
  src-tauri/src/update.rs      self-update: check, verify, install, restart
  src-tauri/src/windowlist.rs  open windows + which one has focus (Win32 / CoreGraphics)
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

## Muting yourself, and trying the recorder

**Mute** (`Ctrl+Alt+M` / `⌘+Option+M`, or the button in the app) drops the
tutor's microphone from the recording: the segment restarts without the
microphone input, so their voice is simply not one of ffmpeg's inputs while it
lasts. Everything else carries on — the screen, and the class audio, so the
students' voices are still recorded. A centred banner says `MICROPHONE MUTED`
for as long as it is on, because a tutor who forgets loses their own voice for
the rest of the class.

It does **not** mute them in Discord. The students in the call still hear them;
only the recording is affected, and the banner says so.

**Test mode** ("Try the recorder") runs a dry class so a tutor can feel the
controls before their first real one. It is deliberately identical to a lesson
— the same overlays with the same wording, the pause and mute hotkeys, the
window-mode freeze banner, and the quit lock, which "End test" always releases
— except that:

* no ffmpeg is started and no segment is written (`session.test`
  short-circuits `startSegment`/`stopSegment`);
* nothing is written to disk (`persistMeta` returns early), so there is nothing
  to upload and nothing to clean up;
* the server is never told about it: the tick reports state `test` and a null
  class id, so it never counts as a recording or a class session.

The class it invents is called "Test class", which is what the overlay shows
where a real class shows its course title. A real class always wins: if one
becomes active while a test is running, the test ends and the real session
takes over.

## Recording windows instead of the whole display

In **Devices → What to record** a tutor can switch from "the whole display" to
"only the windows I choose" and tick the windows they are willing to share.
From then on the recorder shows **the window they are working in, and only if
it is ticked**. On anything else — another app, the desktop, the recorder
itself — the picture freezes on the last shared window while the microphone and
the class audio keep recording, and a banner on the recorded display says
`THIS WINDOW IS NOT BEING RECORDED`.

How it works, and why it was built this way:

* **Cropping, not per-window capture.** The recorder captures the display as it
  always did and crops to the focused window's rectangle (`crop` in
  `CaptureConfig`). Because only the *focused* window is ever recorded, and a
  focused window is the top-most one, the crop shows that window rather than
  what is behind it. True per-window capture (Windows.Graphics.Capture,
  ScreenCaptureKit) would be a whole second capture stack for the same result
  in the normal case — see the limitations below for where the difference bites.
* **One canvas for every segment.** A class is a series of segments stitched
  together without re-encoding, which only works if they all share a size. Every
  segment — display, window, or frozen — is now scaled and letterboxed onto a
  canvas derived from the recorded display (`canvas_for` in `capture.rs`), so a
  class can switch between windows of different shapes and still concatenate.
* **The freeze is the last recorded frame**, pulled out of the segment that just
  ended (`extract_last_frame`) rather than grabbed from the screen: by the time
  a focus change is noticed, the window that took focus may already be covering
  the one being recorded, and grabbing the screen would capture exactly what the
  tutor asked to keep private. With nothing recorded yet the picture is black.
* **Focus is polled every 250 ms** (`FOCUS_POLL_MS`) rather than pushed —
  Windows and macOS disagree about how to subscribe, and asking is cheap.
  `windowlist.rs` declares the dozen platform calls it needs by hand rather than
  adding a bindings crate: `EnumWindows`/`GetForegroundWindow` on Windows, and
  `CGWindowListCopyWindowInfo` on macOS, where the front-to-back ordering
  identifies the focused window without asking for Accessibility permission.
* **Windows are matched by handle**, falling back to the application and title
  they had when they were picked, because handles do not survive closing a
  window or restarting the recorder.
* If the focused window cannot be identified at all, it counts as **not
  shared**. Every failure in this feature has to fail towards not recording.

### Limitations of window mode

* **A focus change is not instant.** Between the tutor switching windows and
  ffmpeg stopping (~250 ms of polling plus shutdown), a few frames of the newly
  focused window can land in the recording if it overlaps the rectangle being
  recorded. Cropping cannot close that gap; only real per-window capture can.
  Tutors with something genuinely sensitive should keep it on another display.
* Anything drawn **on top of** the shared window is recorded with it —
  notification toasts, other always-on-top windows. The recorder's own overlay
  is content-protected on Windows and so stays out of the recording.
* Moving or resizing a shared window restarts the segment, at most once every
  1.2 s (`GEOMETRY_SETTLE_MS`); while it is being dragged the crop is stale, so
  the edges of whatever is behind it can show.
* Each switch restarts ffmpeg, which costs a fraction of a second of audio.
* A window that was reopened with a **different title** is no longer recognised
  and counts as not shared until the tutor ticks it again.
* Mixed-DPI multi-monitor setups on macOS convert window bounds with the
  recorded display's scale factor, which is wrong if the window is on a display
  with a different one.

## Automatic updates

The app updates itself, so a tutor installs it once and never has to download an
installer again.

* Every release build also produces Tauri updater artifacts (`.app.tar.gz` on
  macOS, `-setup.nsis.zip` on Windows) and a `latest.json` manifest, all
  attached to the GitHub release. Installed apps read
  `https://github.com/OoEthanoO/tutoring/releases/latest/download/latest.json`.
* Each artifact is signed with a minisign key; `plugins.updater.pubkey` in
  `tauri.conf.json` is its public half and the app installs nothing whose
  signature does not verify. That signature is the whole security story for an
  app that is otherwise unsigned (no Developer ID, no Authenticode).
* **When it updates** is decided by `updateSafeNow()` in `src/main.js`: only
  while the app is connected to the server (so "no class" is a fresh fact),
  with no class session, nothing waiting to upload, no quit lock, and the next
  class more than 20 minutes away. It checks at startup and every 6 hours. An
  update found during a class simply waits — the tutor sees "installs by itself
  once you are between classes" — so a restart can never interrupt a recording
  or an upload.
* Downloading and installing are deliberately separate (`download_update` /
  `install_update`). The download runs in the background without blocking the
  tick loop, however slow the network is; only when it has finished does the
  app ask again whether this is still a safe moment and then install, which
  takes a moment. So a stalled download can neither stop the recorder from
  arming for the next class nor restart it in the middle of one.
* Installing shows a short modal. Windows then runs the NSIS installer in
  passive mode (per-user, no UAC prompt) and it relaunches the app; macOS
  replaces the `.app` bundle and the app restarts itself. `pendingUpdate` in
  `settings.json` tells the restarted app which version to expect and whether
  it was living in the tray, so a hidden recorder goes back to the tray instead
  of popping a window up in the tutor's face.
* **Check for updates** in the app does the same thing on demand.

### One-time setup: the updater signing key

The release workflow refuses to build until this is done.

1. In `recorder/`, run `npm run updater:keygen`. It writes
   `yanlearn-recorder-updater.key` (private) and `yanlearn-recorder-updater.key.pub`
   (public) *beside* the repository folder, never inside it. Pick a password
   when asked.
2. Add two repository secrets: **TAURI_SIGNING_PRIVATE_KEY** (the whole
   contents of the `.key` file) and **TAURI_SIGNING_PRIVATE_KEY_PASSWORD**.
3. Paste the contents of the `.key.pub` file into `plugins.updater.pubkey` in
   `recorder/src-tauri/tauri.conf.json`, and commit that (public keys are meant
   to be published).

Keep the private key safe and backed up: without it no already-installed
recorder can ever be updated again, and every tutor would have to reinstall by
hand.

## Building the app

CI: push a tag `recorder-v0.1.0` (version in `recorder/package.json`,
`recorder/src-tauri/tauri.conf.json` and `recorder/src-tauri/Cargo.toml`) →
GitHub release with `.dmg` (Apple Silicon and Intel), `.msi` / `-setup.exe`, the
signed updater artifacts and `latest.json`. The Help tab and tutor banner link
to `releases/latest` for first installs; after that every open recorder picks
the release up by itself (see "Automatic updates"). The matrix runs one job at
a time because all three merge into the same `latest.json` asset.

Locally (needs Node 20, Rust stable, and on macOS Xcode CLT):

```bash
cd recorder && npm install && node scripts/fetch-ffmpeg.mjs && npm run icons && npm run dev
```

A local `npm run build` now also signs the updater artifacts, so it needs
`TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) in the
environment; `npm run dev` does not bundle and is unaffected.

macOS also needs the helper: `swiftc -O -target arm64-apple-macos13.0 -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation sysaudio/main.swift -o src-tauri/binaries/sysaudio-aarch64-apple-darwin`.

Builds are **unsigned**. macOS shows "unidentified developer" (right‑click →
Open, or add an Apple Developer ID cert + notarization to the workflow);
Windows SmartScreen shows "More info → Run anyway". Signing is the main thing
to add before rolling out to all tutors.

## Known limitations / follow‑ups

* The overlay is built by an **async** command. On Windows, creating a window
  inside a synchronous Tauri command deadlocks against the WebView2 message
  loop, so `set_overlay` never returned and no overlay ever appeared — in a
  class or in test mode. Any command that creates a window must stay `async`.
  The webview also gives up on the call after 4 s and retries on the next pass,
  so a stuck overlay can never stall the tick loop.
* Compiled and bundled by CI since `recorder-v0.1.0`, but never run against a
  real class. The updater code (`src-tauri/src/update.rs`, written against
  tauri-plugin-updater 2.11) has not been compiled at all yet, and no installed
  copy can be updated until a release newer than the one it came from exists.
* Everyone running 0.1.0 has to reinstall by hand once: those builds shipped
  before the updater existed, so they cannot fetch 0.2.0 themselves.
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
* The updater reads `releases/latest`, i.e. the newest published release of
  this repository whatever it is — if the repo ever publishes a release that is
  not a recorder build, tutors stop seeing updates until the next recorder tag.
* An update is installed the moment the recorder is idle, which can be seconds
  after a tutor opens it. That is deliberate (it is the only guaranteed-safe
  moment), but it means the app can restart itself right after launch.
