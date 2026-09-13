import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { checkRelease, validateAppleSigning } from "./check-release-signing.mjs";
import { verifySignatureDetails } from "./verify-macos-release.mjs";
import { validateReleaseManifest } from "./publish-recorder-release.mjs";

const credentials = {
  APPLE_CERTIFICATE: "fixture", APPLE_CERTIFICATE_PASSWORD: "fixture-password",
  APPLE_SIGNING_IDENTITY: "Developer ID Application: YanLearn (AB12CD34EF)",
  APPLE_TEAM_ID: "AB12CD34EF", APPLE_ID: "test@example.test", APPLE_PASSWORD: "fixture-app-password",
};
const env = { ...credentials, TAURI_SIGNING_PRIVATE_KEY: "fixture-updater-key", GITHUB_TOKEN: "fixture-github-token", GITHUB_REPOSITORY: "OoEthanoO/tutoring", GITHUB_REF_TYPE: "branch" };
afterEach(() => { vi.unstubAllGlobals(); });

describe("release signing preflight", () => {
  it("rejects incomplete setup without printing any secret values", () => {
    for (const name of Object.keys(credentials)) {
      const incomplete = { ...credentials, [name]: "" };
      expect(() => validateAppleSigning(incomplete)).toThrow(name);
      try { validateAppleSigning(incomplete); } catch (error) { expect(error.message).not.toContain("fixture-password"); expect(error.message).not.toContain("fixture-app-password"); }
    }
  });
  it("requires Developer ID Application and matching Team ID", () => {
    expect(() => validateAppleSigning(credentials)).not.toThrow();
    for (const identity of ["-", "Apple Development: YanLearn (AB12CD34EF)", "Apple Distribution: YanLearn (AB12CD34EF)", "Developer ID Application: YanLearn (XX12CD34EF)"]) {
      expect(() => validateAppleSigning({ ...credentials, APPLE_SIGNING_IDENTITY: identity })).toThrow("Developer ID Application");
    }
  });
  it("does not contact GitHub with incomplete Apple credentials", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(checkRelease({})).rejects.toThrow("Missing"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows a new/draft release and rejects replacement of published installers", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 404 })); vi.stubGlobal("fetch", fetcher);
    await expect(checkRelease(env)).resolves.toBeUndefined();
    fetcher.mockResolvedValue(Response.json({ draft: true })); await expect(checkRelease(env)).resolves.toBeUndefined();
    fetcher.mockResolvedValue(Response.json({ draft: false })); await expect(checkRelease(env)).rejects.toThrow("already public");
    fetcher.mockResolvedValue(Response.json({}, { status: 403 })); await expect(checkRelease(env)).rejects.toThrow("Cannot check");
    const [, options] = fetcher.mock.calls[0]; expect(JSON.stringify(options)).not.toContain(credentials.APPLE_PASSWORD);
  });
});

describe("macOS artifact checks", () => {
  const details = "CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded\nAuthority=Developer ID Application: YanLearn (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\nTimestamp=Sep 13, 2026 at 12:00:00\n";
  it("requires a timestamp, hardened runtime and the expected signing team", () => {
    expect(() => verifySignatureDetails(details, "AB12CD34EF")).not.toThrow();
    expect(() => verifySignatureDetails(details, "ZZ12CD34EF")).toThrow("expected");
    expect(() => verifySignatureDetails(details.replace("0x10000(runtime)", "0x0(none)"), "AB12CD34EF")).toThrow("hardened runtime");
    expect(() => verifySignatureDetails(details.replace(/^Timestamp=.*\n/m, ""), "AB12CD34EF")).toThrow("timestamp");
    expect(() => verifySignatureDetails(details.replace("Authority=Developer ID Application:", "Authority=Apple Development:"), "AB12CD34EF")).toThrow("expected");
  });
});

describe("public release gate", () => {
  const repo = "OoEthanoO/tutoring", tag = "recorder-v0.6.0";
  const manifest = { version: "0.6.0", platforms: {
    "darwin-aarch64": { signature: "signed", url: `https://github.com/${repo}/releases/download/${tag}/YanLearn.Recorder.app.tar.gz` },
    "windows-x86_64": { signature: "signed", url: `https://github.com/${repo}/releases/download/${tag}/recorder-setup.exe` },
  } };
  const assets = [{ name: "YanLearn.Recorder.app.tar.gz", size: 100 }, { name: "recorder-setup.exe", size: 100 }, { name: "recorder.dmg", size: 100 }];
  it("requires both signed platform updates and installers before publishing", () => {
    expect(() => validateReleaseManifest(manifest, tag, repo, assets)).not.toThrow();
    expect(() => validateReleaseManifest({ ...manifest, version: "0.5.0" }, tag, repo, assets)).toThrow("version");
    expect(() => validateReleaseManifest(manifest, tag, repo, assets.slice(1))).toThrow("not present");
    expect(() => validateReleaseManifest(manifest, tag, repo, assets.slice(0, 2))).toThrow("installer");
    const broken = structuredClone(manifest); broken.platforms["darwin-aarch64"].signature = "";
    expect(() => validateReleaseManifest(broken, tag, repo, assets)).toThrow("signed updater");
    broken.platforms["darwin-aarch64"] = { signature: "signed", url: "https://elsewhere.example/asset" };
    expect(() => validateReleaseManifest(broken, tag, repo, assets)).toThrow("signed updater");
  });
  it("keeps uploads private until macOS verification and both platform jobs succeed", () => {
    const workflow = yaml.load(readFileSync(".github/workflows/recorder-release.yml", "utf8"));
    expect(workflow.jobs.build.needs).toBe("preflight");
    expect(workflow.jobs.publish.needs).toBe("build");
    expect(workflow.jobs.publish.if).toBe("github.ref_type == 'tag'");
    expect(workflow.jobs.build.strategy["max-parallel"]).toBe(1);
    const steps = workflow.jobs.build.steps;
    const build = steps.findIndex(s => s.uses?.startsWith("tauri-apps/tauri-action"));
    expect(steps[build].with.releaseDraft).toBe(true);
    expect(steps[build].with.releaseCommitish).toBe("${{ github.sha }}");
    const verify = steps.findIndex(s => s.run?.includes("verify-macos-release.mjs"));
    expect(verify).toBeGreaterThan(build); expect(steps[verify].if).toBe("runner.os == 'macOS'");
    expect(steps[verify]["continue-on-error"]).not.toBe(true);
  });
});
