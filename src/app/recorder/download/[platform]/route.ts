import { NextResponse } from "next/server";
import {
  getLatestRecorderRelease,
  recorderReleasesUrl,
  selectRecorderInstaller,
  type RecorderPlatform,
} from "@/lib/recorderRelease";

export async function GET(
  request: Request,
  { params }: { params: { platform: string } | Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (platform !== "windows" && platform !== "macos") {
    return new NextResponse("Unsupported recorder platform.", { status: 404 });
  }

  const release = await getLatestRecorderRelease();
  const installer = selectRecorderInstaller(
    release,
    platform as RecorderPlatform
  );

  return NextResponse.redirect(
    new URL(installer?.browser_download_url ?? recorderReleasesUrl, request.url),
    307
  );
}

