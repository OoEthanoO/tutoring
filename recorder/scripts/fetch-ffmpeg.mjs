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

import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import os from "node:os";
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
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
    archive: "zip",
    binaryName: "ffmpeg.exe",
  },
  "aarch64-apple-darwin": {
    url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
    archive: "zip",
    binaryName: "ffmpeg",
  },
  "x86_64-apple-darwin": {
    url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip",
    archive: "zip",
    binaryName: "ffmpeg",
  },
};

const source = sources[triple];
if (!source) {
  throw new Error(`No ffmpeg source configured for ${triple}`);
}
const override = process.env[`FFMPEG_URL_${triple.replaceAll("-", "_")}`];
const url = override || source.url;
const ext = triple.includes("windows") ? ".exe" : "";
const target = path.join(binariesDir, `ffmpeg-${triple}${ext}`);

if (existsSync(target) && statSync(target).size > 1_000_000 && !process.env.FFMPEG_FORCE) {
  console.log(`ffmpeg already present at ${target}`);
  process.exit(0);
}

mkdirSync(binariesDir, { recursive: true });
const workDir = path.join(os.tmpdir(), `yanlearn-ffmpeg-${Date.now()}`);
mkdirSync(workDir, { recursive: true });
const archivePath = path.join(workDir, "ffmpeg.zip");

console.log(`Downloading ${url}`);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));

// Both Windows 10+ (bsdtar) and macOS ship a tar that extracts zip files.
execSync(`tar -xf "${archivePath}" -C "${workDir}"`, { stdio: "inherit" });

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
// copy rather than rename: on the Windows CI runner the temp directory is on
// C: and the checkout on D:, and a rename across drives fails with EXDEV.
copyFileSync(binary, target);
if (!ext) {
  chmodSync(target, 0o755);
}
rmSync(workDir, { recursive: true, force: true });
console.log(`ffmpeg ready at ${target}`);
