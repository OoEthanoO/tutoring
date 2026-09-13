import { spawnSync } from "node:child_process";

// Never include argv in failures: notarytool receives an app-specific password.
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    let detail = result.stderr || result.error?.message || "No diagnostic output.";
    for (const key of ["APPLE_PASSWORD", "APPLE_CERTIFICATE_PASSWORD", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
      if (process.env[key]) detail = detail.replaceAll(process.env[key], "[redacted]");
    }
    throw new Error(`${command} failed (exit ${result.status ?? "unknown"}): ${detail}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
