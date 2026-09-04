"use client";

export const recorderDownloadUrl = "https://github.com/OoEthanoO/tutoring/releases/latest";

/**
 * Shown to tutors: from 2026-09-09 every class must be recorded with the
 * YanLearn Recorder desktop app. The rules here mirror src/lib/recorderPolicy.ts.
 */
export default function RecorderNotice() {
  return (
    <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
        YanLearn Recorder
      </p>
      <p className="text-sm text-[var(--foreground)]">
        Starting <span className="font-semibold">September 9, 2026</span>, every class must be recorded
        with YanLearn Recorder. Sign in to the app and have it open at least{" "}
        <span className="font-semibold">5 minutes before</span> each class starts — it records
        automatically while you are in the class voice channel and uploads when the class is done.
      </p>
      <p className="text-xs text-[var(--muted)]">
        Pause with <span className="font-semibold">Ctrl+Alt+P</span> (macOS:{" "}
        <span className="font-semibold">⌘+Option+P</span>). Recordings are only visible to the
        students enrolled in your course and are deleted after 7 days. The app keeps itself up to
        date, so you only download it once. See the Help tab for details.
      </p>
      <a
        href={recorderDownloadUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded-full border border-amber-500/40 px-3 py-1 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-amber-500/20"
      >
        Download YanLearn Recorder (macOS &amp; Windows)
      </a>
    </div>
  );
}
