# YanLearn Recorder: macOS signing and notarization

The release workflow is prepared for Developer ID signing and notarization.
Actual Apple acceptance is pending the first macOS build;
an unsigned historical release does not become notarized when this code ships.
The latest published Recorder release was `recorder-v0.5.0` when setup began.
Use a new version/tag for the first notarized release.

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
The first validation uses a manual build from a separate branch and keeps the
artifacts in a draft release. This does not deploy the website or publish an update.

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
   Tauri signs the app, `ffmpeg`, and `sysaudio`, notarizes the app, and staples
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

## Validation and first release

Local tests cover credential rejection, artifact metadata checks, updater
completeness, and the draft/publish workflow gate. Windows cannot run Apple's
`codesign`, `notarytool`, `stapler`, or Gatekeeper checks. The first actual macOS
CI run must pass those checks before this setup can be called notarized.

After publishing, download the DMG from YanLearn on a Mac, install and launch
normally, grant capture permissions, test microphone and system audio, and
verify an installed Recorder can update to the new release. Update the public
download page's historical unsigned-install instructions after that succeeds.
This setup does not create a release tag or push code on its own.
