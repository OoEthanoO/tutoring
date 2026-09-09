import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  getLatestRecorderRelease,
  recorderVersion,
  selectRecorderInstaller,
} from "@/lib/recorderRelease";

export const metadata: Metadata = {
  title: "Download YanLearn Recorder",
  description:
    "Download YanLearn Recorder for Windows or Apple silicon Mac.",
};

export const revalidate = 300;

const formatMegabytes = (bytes: number | undefined) =>
  bytes ? `${Math.round(bytes / 1_000_000)} MB` : null;

function DownloadArrow() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"
      />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M3 5.2 10.4 4v7.1H3V5.2Zm8.3-1.3L21 2.5v8.6h-9.7V3.9ZM3 12h7.4v7L3 17.8V12Zm8.3 0H21v8.6l-9.7-1.4V12Z" />
    </svg>
  );
}

function MacIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M16.7 12.9c0-2.5 2.1-3.7 2.2-3.8a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-1-3.3-.9A4.9 4.9 0 0 0 3.8 9.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3 0 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.2 3.1-2.5a11 11 0 0 0 1.4-2.9 4.5 4.5 0 0 1-3-4Zm-2.6-7.5A4.5 4.5 0 0 0 15.2 2a4.7 4.7 0 0 0-3.1 1.6A4.2 4.2 0 0 0 11 6.8a3.9 3.9 0 0 0 3.1-1.4Z" />
    </svg>
  );
}

type DownloadCardProps = {
  platform: "windows" | "macos";
  title: string;
  compatibility: string;
  size: string | null;
  icon: React.ReactNode;
  steps: React.ReactNode[];
};

function DownloadCard({
  platform,
  title,
  compatibility,
  size,
  icon,
  steps,
}: DownloadCardProps) {
  return (
    <section className="flex h-full flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--foreground)] text-[var(--background)]">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[var(--foreground)]">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {compatibility}
          </p>
        </div>
      </div>

      <a
        href={`/recorder/download/${platform}`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-[var(--background)] transition hover:opacity-85"
      >
        <DownloadArrow />
        Download for {title}
        {size ? <span className="font-normal opacity-70">· {size}</span> : null}
      </a>

      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          Install in three steps
        </p>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed text-[var(--foreground)]">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default async function RecorderDownloadPage() {
  const release = await getLatestRecorderRelease();
  const version = recorderVersion(release);
  const windowsInstaller = selectRecorderInstaller(release, "windows");
  const macInstaller = selectRecorderInstaller(release, "macos");

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <nav className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/10">
              <Image src="/logo.svg" alt="" width={27} height={27} />
            </span>
            YanLearn
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Back to YanLearn
          </Link>
        </nav>

        <header className="mx-auto max-w-3xl pb-10 pt-16 text-center sm:pb-12 sm:pt-20">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {version ? `Latest version ${version}` : "Latest version"}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Download YanLearn Recorder
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Choose your computer below. After installing, sign in with your
            YanLearn account and the recorder will keep itself up to date.
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <DownloadCard
            platform="windows"
            title="Windows"
            compatibility="Windows 10 or later · 64-bit"
            size={formatMegabytes(windowsInstaller?.size)}
            icon={<WindowsIcon />}
            steps={[
              <>
                Open the downloaded <span className="font-semibold">setup.exe</span> file.
              </>,
              <>
                If Windows SmartScreen appears, choose <span className="font-semibold">More info</span>, then <span className="font-semibold">Run anyway</span>.
              </>,
              <>Open YanLearn Recorder and sign in with your YanLearn account.</>,
            ]}
          />
          <DownloadCard
            platform="macos"
            title="Mac"
            compatibility="macOS 12.3 or later · Apple silicon"
            size={formatMegabytes(macInstaller?.size)}
            icon={<MacIcon />}
            steps={[
              <>
                Open the downloaded <span className="font-semibold">DMG</span> and move YanLearn Recorder to Applications.
              </>,
              <>
                The first time, right-click the app and choose <span className="font-semibold">Open</span>, then confirm.
              </>,
              <>Sign in and allow Screen Recording and Microphone access when asked.</>,
            ]}
          />
        </div>

        <section className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface-muted)] px-6 py-5 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <h2 className="text-sm font-semibold">Already installed?</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
              You do not need to download every release. YanLearn Recorder updates itself automatically between classes.
            </p>
          </div>
          <p className="mt-4 shrink-0 text-xs text-[var(--muted)] sm:mt-0">
            Intel Macs are not currently supported.
          </p>
        </section>

        <footer className="pt-8 text-center text-xs leading-relaxed text-[var(--muted)]">
          Need help choosing? On a Mac, open Apple menu → About This Mac. If it
          says M1, M2, M3, M4, or Apple, use the Mac download.
        </footer>
      </div>
    </main>
  );
}

