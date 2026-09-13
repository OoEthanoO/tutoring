import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateAppleSigning(env) {
  const required = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing GitHub Actions secrets: ${missing.join(", ")}. See MACOS_NOTARIZATION.md.`);
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error("APPLE_TEAM_ID must be the 10-character Apple Developer team ID.");
  if (!env.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application: ") ||
      !env.APPLE_SIGNING_IDENTITY.endsWith(`(${env.APPLE_TEAM_ID})`) || /[\r\n]/.test(env.APPLE_SIGNING_IDENTITY)) {
    throw new Error("APPLE_SIGNING_IDENTITY must be a Developer ID Application identity for APPLE_TEAM_ID. Development, App Store, and ad-hoc signatures cannot be released.");
  }
}

export async function checkRelease(env = process.env) {
  validateAppleSigning(env);
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for automatic updates.");
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  if (!config.plugins?.updater?.pubkey?.trim()) throw new Error("The Recorder updater public key is missing.");
  const tag = env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME : "recorder-dev";
  if (env.GITHUB_REF_TYPE === "tag" && tag !== `recorder-v${config.version}`) throw new Error("The release tag must match the Recorder version.");
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw new Error("Run release preflight inside GitHub Actions.");
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Cannot check the release destination (${response.status}).`);
  if (!(await response.json()).draft) throw new Error("This release is already public. Bump the version and create a new tag instead of replacing installers in a published release.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  checkRelease().then(() => console.log("Release signing credentials and draft destination checked."))
    .catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
