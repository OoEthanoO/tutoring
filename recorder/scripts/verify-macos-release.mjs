import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "./release-process.mjs";

export function verifySignatureDetails(text, teamId, executable = true) {
  if (!text.includes(`TeamIdentifier=${teamId}\n`) || !/^Authority=Developer ID Application: /m.test(text)) throw new Error("An artifact lacks the expected Developer ID Application signature.");
  if (executable && !/^CodeDirectory .*flags=.*\bruntime\b/m.test(text)) throw new Error("A recording executable is missing the hardened runtime.");
  if (!/^Timestamp=/m.test(text)) throw new Error("An artifact lacks a secure signing timestamp.");
}

function verifyApp(app, teamId) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  const plist = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents", "Info.plist")]).stdout);
  if (plist.CFBundleIdentifier !== "com.yanlearn.recorder") throw new Error("Unexpected app identifier in release.");
  for (const binary of [plist.CFBundleExecutable, "ffmpeg", "sysaudio"]) {
    if (!binary || path.basename(binary) !== binary) throw new Error("Invalid recording executable name.");
    const target = path.join(app, "Contents", "MacOS", binary);
    if (!existsSync(target)) throw new Error(`Missing recording executable: ${binary}`);
    run("codesign", ["--verify", "--strict", target]);
    const details = run("codesign", ["--display", "--verbose=4", target]);
    verifySignatureDetails(details.stdout + details.stderr, teamId);
    // Modern codesign defaults to a human-readable dictionary, not a plist.
    const entitlements = run("codesign", ["--display", "--entitlements", "-", "--xml", target]).stdout;
    const values = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", "-"], { input: entitlements }).stdout);
    if (values["com.apple.security.device.audio-input"] !== true || values["com.apple.security.get-task-allow"] === true) throw new Error(`Invalid recording entitlements for ${binary}.`);
  }
}

export function verifyMacRelease(target, env = process.env) {
  if (process.platform !== "darwin") throw new Error("macOS artifact verification must run on the GitHub macOS runner.");
  if (target !== "aarch64-apple-darwin") throw new Error("Unsupported macOS release target.");
  if (!env.APPLE_ID || !env.APPLE_PASSWORD || !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "")) throw new Error("Apple notarization credentials are missing.");
  if (!env.RELEASE_TAG || !env.GH_REPO) throw new Error("Release destination is missing.");
  const bundle = path.resolve("src-tauri", "target", target, "release", "bundle");
  const appName = "YanLearn Recorder.app";
  const app = path.join(bundle, "macos", appName);
  verifyApp(app, env.APPLE_TEAM_ID);
  console.log("Verified the signed, stapled app and its recording helpers.");

  // The updater must contain the stapled app too, not just the local .app.
  const archive = path.join(bundle, "macos", `${appName}.tar.gz`);
  const scratch = mkdtempSync(path.join(tmpdir(), "yanlearn-notary-"));
  try {
    run("tar", ["-xzf", archive, "-C", scratch]);
    verifyApp(path.join(scratch, appName), env.APPLE_TEAM_ID);
    console.log("Verified the app extracted from the updater archive.");

    const dmgs = readdirSync(path.join(bundle, "dmg")).filter(name => name.endsWith(".dmg"));
    if (dmgs.length !== 1) throw new Error("Expected exactly one macOS installer.");
    const dmg = path.join(bundle, "dmg", dmgs[0]);
    run("codesign", ["--verify", "--strict", dmg]);
    const details = run("codesign", ["--display", "--verbose=4", dmg]);
    verifySignatureDetails(details.stdout + details.stderr, env.APPLE_TEAM_ID, false);
    // Tauri notarizes the app; the outer DMG needs its own submission/ticket.
    const credentials = ["--apple-id", env.APPLE_ID, "--password", env.APPLE_PASSWORD, "--team-id", env.APPLE_TEAM_ID];
    console.log("Submitting the DMG to Apple for notarization.");
    const result = JSON.parse(run("xcrun", ["notarytool", "submit", dmg, ...credentials, "--wait", "--timeout", "30m", "--output-format", "json"]).stdout);
    if (result.status !== "Accepted") throw new Error(`Apple did not accept the DMG (${result.status ?? "unknown"}; submission ${result.id ?? "unknown"}).`);
    console.log(`Apple accepted the DMG (submission ${result.id}).`);
    run("xcrun", ["stapler", "staple", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
    run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]);

    // Stapling changes the DMG bytes. Replace only that asset on the draft;
    // the already-signed updater archive and its signature stay untouched.
    const release = JSON.parse(run("gh", ["release", "view", env.RELEASE_TAG, "--json", "isDraft"]).stdout);
    if (!release.isDraft) throw new Error("Refusing to replace a public release asset.");
    run("gh", ["release", "upload", env.RELEASE_TAG, dmg, "--clobber"]);
    console.log("App, recording helpers, updater archive and DMG passed macOS release checks.");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  try { verifyMacRelease(process.argv[2]); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
