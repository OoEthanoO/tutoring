// Downloads a static ffmpeg build for the current (or requested) target triple
// into src-tauri/binaries/ffmpeg-<triple>[.exe], where Tauri picks it up as the
// `binaries/ffmpeg` sidecar. Run before `tauri dev` / `tauri build`.
//
//   node scripts/fetch-ffmpeg.mjs                     # host triple
//   node scripts/fetch-ffmpeg.mjs aarch64-apple-darwin # explicit triple
//
// Sources (all GPL static builds; ffmpeg's own licence notice applies):
//   Windows x64:   BtbN/FFmpeg-Builds (GitHub releases)
//   macOS arm64:   ffmpeg.martin-riedl.de
//   macOS x86_64:  ffmpeg.martin-riedl.de
// Override any URL with FFMPEG_URL_<triple with dashes as underscores>.
//
// BtbN republishes its rolling `latest` release every day, deleting and
// re-uploading the assets as it goes. A build that lands inside that window
// gets a 404 from an otherwise valid URL, for up to half an hour. So on a 404
// we fall back to the newest immutable `autobuild-*` release via the releases
// API, whose assets carry build-specific names that cannot be hardcoded.

import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const binariesDir = path.join(here, "..", "src-tauri", "binaries");

const hostTriple = () => {
  const arch = os.arch();
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  throw new Error(`Unsupported platform ${process.platform}`);
};

const triple = process.argv[2] ?? hostTriple();
const sources = {
  "x86_64-pc-windows-msvc": {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    binaryName: "ffmpeg.exe",
    // Fallback: newest immutable release in this repo with an asset whose name
    // ends in this suffix (which excludes the "-shared" and versioned builds).
    githubRepo: "BtbN/FFmpeg-Builds",
    assetSuffix: "win64-gpl.zip",
  },
  "aarch64-apple-darwin": {
    url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
    binaryName: "ffmpeg",
  },
  "x86_64-apple-darwin": {
    url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip",
    binaryName: "ffmpeg",
  },
};

const source = sources[triple];
if (!source) {
  throw new Error(`No ffmpeg source configured for ${triple}`);
}
const override = process.env[`FFMPEG_URL_${triple.replaceAll("-", "_")}`];
const primaryUrl = override || source.url;
const ext = triple.includes("windows") ? ".exe" : "";
const target = path.join(binariesDir, `ffmpeg-${triple}${ext}`);

if (existsSync(target) && statSync(target).size > 1_000_000 && !process.env.FFMPEG_FORCE) {
  console.log(`ffmpeg already present at ${target}`);
  process.exit(0);
}

/** GET with retries for transient network and 5xx failures. 404 is returned, not retried. */
const fetchWithRetry = async (url, attempts = 4) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok || response.status === 404) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      const delay = 2000 * attempt;
      console.log(`  attempt ${attempt} failed (${lastError.message}); retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error("Download failed");
};

/** Newest release in `repo` carrying an asset whose name ends with `suffix`. */
const resolveFromReleases = async (repo, suffix) => {
  const headers = { Accept: "application/vnd.github+json" };
  // Actions runners share outbound IPs, so use the job token when present to
  // avoid the unauthenticated rate limit.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, { headers });
  if (!response.ok) {
    throw new Error(`Could not list releases for ${repo}: HTTP ${response.status}`);
  }
  const releases = await response.json();
  for (const release of releases) {
    // Skip the rolling release; its assets are the ones that vanish mid-rebuild.
    if (release.tag_name === "latest") {
      continue;
    }
    const asset = (release.assets ?? []).find((item) => item.name.endsWith(suffix));
    if (asset) {
      return { url: asset.browser_download_url, tag: release.tag_name, name: asset.name };
    }
  }
  throw new Error(`No release asset ending in "${suffix}" found in ${repo}`);
};

mkdirSync(binariesDir, { recursive: true });
const workDir = path.join(os.tmpdir(), `yanlearn-ffmpeg-${Date.now()}`);
mkdirSync(workDir, { recursive: true });
const archivePath = path.join(workDir, "ffmpeg.zip");

console.log(`Downloading ${primaryUrl}`);
let response = await fetchWithRetry(primaryUrl);
if (response.status === 404 && source.githubRepo && !override) {
  console.log("  404 — the rolling release is likely mid-rebuild; falling back to the newest dated release");
  const fallback = await resolveFromReleases(source.githubRepo, source.assetSuffix);
  console.log(`Downloading ${fallback.name} from ${fallback.tag}`);
  response = await fetchWithRetry(fallback.url);
}
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));

// Windows 10+ and macOS both ship bsdtar, which reads zip archives. On Windows
// it must be named explicitly: Git Bash puts GNU tar earlier on PATH, and GNU
// tar cannot read zip at all ("This does not look like a tar archive").
// Extract from inside workDir with a relative filename too, since GNU tar reads
// an absolute "C:\..." argument as a remote host:path.
const tarBin =
  process.platform === "win32"
    ? `${(process.env.SystemRoot || "C:\\Windows").replaceAll("\\", "/")}/System32/tar.exe`
    : "tar";
execSync(`"${tarBin}" -xf "${path.basename(archivePath)}"`, { cwd: workDir, stdio: "inherit" });

const findBinary = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full);
      if (found) return found;
    } else if (entry.name === source.binaryName) {
      return full;
    }
  }
  return null;
};

const binary = findBinary(workDir);
if (!binary) {
  throw new Error(`Could not find ${source.binaryName} inside the downloaded archive`);
}
// Copy rather than rename: on the Windows CI runner the temp directory is on
// C: and the checkout on D:, and a rename across drives fails with EXDEV.
copyFileSync(binary, target);
if (!ext) {
  chmodSync(target, 0o755);
}
rmSync(workDir, { recursive: true, force: true });
console.log(`ffmpeg ready at ${target}`);
