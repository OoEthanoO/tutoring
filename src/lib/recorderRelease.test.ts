import { describe, expect, it } from "vitest";
import {
  recorderVersion,
  selectRecorderInstaller,
  type RecorderRelease,
} from "./recorderRelease";

const release: RecorderRelease = {
  tag_name: "recorder-v0.5.0",
  published_at: "2026-09-07T02:45:11Z",
  assets: [
    {
      name: "latest.json",
      browser_download_url:
        "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v0.5.0/latest.json",
      size: 1,
    },
    {
      name: "YanLearn.Recorder_0.5.0_x64-setup.exe",
      browser_download_url:
        "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v0.5.0/YanLearn.Recorder_0.5.0_x64-setup.exe",
      size: 44_203_005,
    },
    {
      name: "YanLearn.Recorder_0.5.0_x64-setup.exe.sig",
      browser_download_url:
        "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v0.5.0/YanLearn.Recorder_0.5.0_x64-setup.exe.sig",
      size: 432,
    },
    {
      name: "YanLearn.Recorder_0.5.0_aarch64.dmg",
      browser_download_url:
        "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v0.5.0/YanLearn.Recorder_0.5.0_aarch64.dmg",
      size: 32_312_470,
    },
    {
      name: "YanLearn.Recorder_0.5.0_x64.dmg",
      browser_download_url:
        "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v0.5.0/YanLearn.Recorder_0.5.0_x64.dmg",
      size: 37_876_935,
    },
  ],
};

describe("selectRecorderInstaller", () => {
  it("selects the friendly Windows installer rather than updater artifacts", () => {
    expect(selectRecorderInstaller(release, "windows")?.name).toBe(
      "YanLearn.Recorder_0.5.0_x64-setup.exe"
    );
  });

  it("selects only the supported Apple silicon Mac build", () => {
    expect(selectRecorderInstaller(release, "macos")?.name).toBe(
      "YanLearn.Recorder_0.5.0_aarch64.dmg"
    );
  });

  it("does not trust an installer URL outside the YanLearn release path", () => {
    const unsafeRelease: RecorderRelease = {
      ...release,
      assets: [
        {
          name: "YanLearn.Recorder_0.5.0_x64-setup.exe",
          browser_download_url: "https://example.com/not-the-recorder.exe",
          size: 1,
        },
      ],
    };
    expect(selectRecorderInstaller(unsafeRelease, "windows")).toBeNull();
  });
});

describe("recorderVersion", () => {
  it("shows a release tag as a normal version", () => {
    expect(recorderVersion(release)).toBe("0.5.0");
  });
});

