# YanLearn Recorder: macOS signing and notarization

Developer ID signing and notarization are included in the published
[v0.5.2 release](https://github.com/OoEthanoO/tutoring/releases/tag/recorder-v0.5.2).
Both platform builds, Apple's app and DMG checks, and publication passed in the
[release workflow](https://github.com/OoEthanoO/tutoring/actions/runs/35656423465).
Historical releases do not become notarized retroactively.

## Setup status (September 13, 2026)

The downloaded Developer ID Application certificate matches the prepared private
key. Its signature chain and dates were checked against Apple's published CA
certificates. OpenSSL does not recognize Apple's critical Developer ID extension,
so that extension was checked explicitly; native Apple policy validation still
runs in macOS CI before publication.

A password-protected `YanLearnRecorder-DeveloperID.p12` was exported in
`C:\Users\ethan\yanlearn-recorder-signing`, including the intermediate certificate.
Its password backup, `YanLearnRecorder-DeveloperID-password.dpapi`, is encrypted
for the current Windows user. Neither file belongs in the repository.

All six required Apple Actions secret names are present in the repository:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_TEAM_ID`, `APPLE_ID`, and `APPLE_PASSWORD`. Their values are not readable
back from GitHub; the macOS build validates the credentials with Apple.
For future credential replacement, use
[GitHub repository secrets](https://github.com/OoEthanoO/tutoring/settings/secrets/actions):

- `APPLE_ID`: the Apple Account email for this Developer Program membership.
- `APPLE_PASSWORD`: an app-specific password generated at
  [Apple Account](https://account.apple.com/) under **Sign-In and Security →
  App-Specific Passwords**. Name it **YanLearn Recorder**. Do not use the normal
  Apple Account password or paste either password into chat.

The supplied certificate uses Apple's G1 intermediate and expires on
**February 1, 2027 at 22:12:15 UTC**. Replace it before signing releases after
that date; choose the current Developer ID certificate authority on renewal.
The initial validation used a manual build from a separate branch and kept the
artifacts in the `recorder-dev` draft. That run did not publish an update;
the versioned v0.5.1 build subsequently passed and was published.

## Certificate creation and replacement

The Apple Developer membership is already available. A Windows-generated,
verified RSA-2048 request is ready at:

`C:\Users\ethan\yanlearn-recorder-signing\YanLearnRecorder-DeveloperID.certSigningRequest`

Its matching private key is in the same protected folder, outside this repo.
Use the **DeveloperID** request above; an earlier experimental request in the
folder is not the one selected for this setup. Keep the private key locally.

1. As the Apple Developer Account Holder, open
   [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list).
2. Choose **+**, then **Developer ID Application**. Use the current certificate
   option if Apple offers a choice of certificate authorities.
3. Upload the `.certSigningRequest` above, continue, and download the `.cer`.
4. Save the certificate in the protected signing folder. Pair it with
   `YanLearnRecorder-DeveloperID-private.pem` when exporting the password-protected
   `.p12` for GitHub. A downloaded certificate alone does not contain the key.

Apple documents the certificate type and Account Holder requirement in
[Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
There is no Mac App Store submission or Developer ID Installer certificate
needed for this app-and-DMG distribution.

## GitHub repository secrets

Add these under this repo's **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the exported `.p12`, containing the certificate and its matching private key. |
| `APPLE_CERTIFICATE_PASSWORD` | The password protecting that `.p12`. |
| `APPLE_SIGNING_IDENTITY` | Exact identity from the issued certificate: `Developer ID Application: Your Name or Organization (TEAMID)`. |
| `APPLE_ID` | The Apple Account email used for notarization. |
| `APPLE_PASSWORD` | An Apple **app-specific password**, created at [account.apple.com](https://account.apple.com/), under Sign-In and Security. |
| `APPLE_TEAM_ID` | The 10-character Team ID from Apple Developer membership details. |

These are the environment variables supported by
[Tauri's macOS signing and notarization integration](https://v2.tauri.app/distribute/sign/macos/).
The existing `TAURI_SIGNING_PRIVATE_KEY` and its password are still required:
the updater signature and Apple's application signature serve different checks.
Do not replace the updater key or its pinned public key for this setup.

For a `.p12` already exported from a Mac, Windows PowerShell can send its base64
straight to GitHub without printing it (replace the filename with the real path):

```powershell
$recorderP12 = 'C:\Users\ethan\yanlearn-recorder-signing\YanLearnRecorder.p12'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($recorderP12)) | gh secret set APPLE_CERTIFICATE --repo OoEthanoO/tutoring
```

Never paste the private key, certificate password or app-specific password into
a public issue or commit. The repo ignores private `.pem`, `.p12`, `.p8`, and
`.key` files; the signing folder is outside the checkout.

## What releases do

1. Preflight checks required secret names, the Developer ID identity/team,
   updater key, version, and release destination. Missing Apple setup fails
   before either expensive platform build. Published releases cannot be replaced.
2. The macOS build enables the hardened runtime and the audio-input entitlement.
   Tauri signs the app, `ffmpeg`, `sysaudio`, and `wincapture`, notarizes the app, and staples
   Apple's ticket. The helpers need the audio entitlement too.
3. Installers and updater artifacts are uploaded to a **draft** release. Verification
   checks both the local app and the app extracted from the updater archive:
   bundle ID, signatures, signing team, timestamps, hardened runtime, entitlements,
   stapled ticket, and Gatekeeper assessment.
4. The outer DMG is submitted to Apple, stapled, validated and assessed, then its
   finalized bytes replace the draft DMG asset. The updater archive is unchanged.
   Apple's [custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
   describes notarizing and stapling distribution containers.
5. Only after both platforms succeed does the publish job validate that the
   matching signed updater artifacts and installers exist, then publish the
   tagged release. A failed notarization leaves it in draft and installed apps
   continue to use the previous public release. Manual development runs stay drafts.

The Windows build and the Apple-silicon-only platform selection are preserved.
Microphone, Screen Recording, and system-audio consent still need to be granted
on each Mac; notarization does not grant capture permissions automatically.

## Validation and publication

The v0.5.2 release passed on September 21, 2026, in run `35656423465`, built
from commit `b7901bf60ff43060b8d1d4751fde2e1c4eb89d07` (`recorder-v0.5.2`):

- Apple app submission: `8418b87c-c388-4ff0-8734-85c10a7cbb03`, **Accepted**.
- Apple DMG submission: `3217fab2-5b51-4ed4-95bd-83dffb965836`, **Accepted**.
- App, helpers, updater archive and DMG passed signature, entitlement,
  stapled-ticket and Gatekeeper checks.
- Native shutdown and upload regression tests passed on both macOS and Windows.
- Both platform installers and updater downloads are available publicly;
  updater signature files match the manifest, and YanLearn's download page and
  platform links serve v0.5.2.

### Initial v0.5.1 verification

Seven local tests cover credential rejection, artifact metadata checks, updater
completeness, and the draft/publish workflow gate. The macOS and Windows jobs
both passed in run `34796311420`, built from commit
`23a488337a00981bff0bc9a9f189f7006dc0e8bd` (`recorder-v0.5.1`):

- Apple app submission: `a23e0a80-cd7f-43af-a771-c3fc999db610`, **Accepted**.
- Apple DMG submission: `68a24395-9cbd-4caa-a27e-eb1546ef2834`, **Accepted**.
- App and recording-helper signatures, timestamps, hardened runtime and audio
  entitlements passed; the app extracted from the updater archive passed too.
- Stapled tickets and Gatekeeper assessments passed for the app and DMG.
- Windows installers and signed updater artifacts were built successfully.
- Both platform entries in the public `latest.json` point to available release
  assets and match their uploaded signature files.
- The publish job succeeded; the public automatic-update endpoint served 0.5.1.

The earlier manual validation passed in run `34777686521`; its development
artifacts remain in draft and are not used by automatic updates.

Entitlement inspection explicitly uses `codesign --display --entitlements -
--xml`: current macOS otherwise prints a human-readable dictionary that cannot
be parsed as a plist.

An interactive launch, capture-permission and installed-app update test on a
user's Mac remains to be done; CI notarization does not exercise those flows.

After publishing, download the DMG from YanLearn on a Mac, install and launch
normally, grant capture permissions, test microphone and system audio, and
verify an installed Recorder can update to the new release. Update the public
download page's historical unsigned-install instructions after that succeeds.
This setup does not create a release tag or push code on its own.
