import { run } from "./release-process.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateReleaseManifest(manifest, tag, repo, assets) {
  if (!tag.startsWith("recorder-v") || manifest.version !== tag.slice("recorder-v".length)) throw new Error("Updater manifest version does not match the release tag.");
  for (const platform of ["darwin-aarch64", "windows-x86_64"]) {
    const entry = manifest.platforms?.[platform];
    const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
    if (!entry?.signature?.trim() || !entry.url?.startsWith(prefix)) throw new Error(`Missing or invalid signed updater for ${platform}.`);
    const name = decodeURIComponent(entry.url.slice(prefix.length));
    if (!assets.some(asset => asset.name === name && asset.size > 0)) throw new Error(`Updater artifact is not present on the draft: ${platform}.`);
  }
  if (!assets.some(a => a.name.endsWith(".dmg") && a.size > 0) || !assets.some(a => a.name.endsWith("-setup.exe") && a.size > 0)) throw new Error("A platform installer is missing from the draft.");
}

export function publishRelease(env = process.env) {
  const tag = env.RELEASE_TAG;
  if (!tag?.startsWith("recorder-v") || !env.GH_REPO) throw new Error("A versioned release tag and GitHub repository are required.");
  const release = JSON.parse(run("gh", ["release", "view", tag, "--json", "isDraft,assets"]).stdout);
  if (!release.isDraft) throw new Error("The release is already public.");
  const manifest = JSON.parse(run("gh", ["release", "download", tag, "--pattern", "latest.json", "--output", "-"]).stdout);
  validateReleaseManifest(manifest, tag, env.GH_REPO, release.assets);
  run("gh", ["release", "edit", tag, "--draft=false", "--latest"]);
  console.log(`Published ${tag} after both platform builds and macOS notarization checks passed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  try { publishRelease(); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
