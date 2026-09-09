export const recorderReleasesUrl =
  "https://github.com/OoEthanoO/tutoring/releases/latest";

const recorderReleaseApiUrl =
  "https://api.github.com/repos/OoEthanoO/tutoring/releases/latest";
const recorderAssetUrlPrefix =
  "https://github.com/OoEthanoO/tutoring/releases/download/recorder-v";

export type RecorderPlatform = "windows" | "macos";

export type RecorderReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type RecorderRelease = {
  tag_name: string;
  published_at: string;
  assets: RecorderReleaseAsset[];
};

const isRecorderRelease = (value: unknown): value is RecorderRelease => {
  if (!value || typeof value !== "object") return false;
  const release = value as Partial<RecorderRelease>;
  return (
    typeof release.tag_name === "string" &&
    release.tag_name.startsWith("recorder-v") &&
    typeof release.published_at === "string" &&
    Array.isArray(release.assets)
  );
};

export const recorderVersion = (release: RecorderRelease | null) =>
  release?.tag_name.replace(/^recorder-v/, "") ?? null;

export const selectRecorderInstaller = (
  release: RecorderRelease | null,
  platform: RecorderPlatform
) => {
  if (!release) return null;

  const installerPattern =
    platform === "windows"
      ? /_x64-setup\.exe$/i
      : /_aarch64\.dmg$/i;

  return (
    release.assets.find(
      (asset) =>
        installerPattern.test(asset.name) &&
        asset.browser_download_url.startsWith(recorderAssetUrlPrefix)
    ) ?? null
  );
};

export const getLatestRecorderRelease = async () => {
  try {
    const response = await fetch(recorderReleaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;

    const release: unknown = await response.json();
    return isRecorderRelease(release) ? release : null;
  } catch {
    return null;
  }
};

