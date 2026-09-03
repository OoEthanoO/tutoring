"use client";

import { useCallback, useEffect, useState } from "react";

type RecordingSummary = {
  id: string;
  classId: string;
  courseId: string;
  courseTitle: string;
  classTitle: string;
  tutorName: string;
  classStartsAt: string | null;
  durationSeconds: number | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  viewerRole: "tutor" | "student";
};

const formatDuration = (seconds: number | null) => {
  if (!seconds || seconds <= 0) {
    return "";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
};

const formatExpiry = (expiresAt: string | null, nowMs: number) => {
  if (!expiresAt) {
    return "";
  }
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "Expired";
  }
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) {
    return `Available for ${days} more ${days === 1 ? "day" : "days"}`;
  }
  return `Available for ${Math.max(hours, 1)} more ${hours === 1 ? "hour" : "hours"}`;
};

/**
 * Streams one recording through the API. The player deliberately offers no
 * download affordance: no download control, no picture-in-picture, no context
 * menu, and the stream URL is a per-viewer token that the server refuses to
 * serve to anything but a media element.
 */
function RecordingPlayer({ recording, onClose }: { recording: RecordingSummary; onClose: () => void }) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`/api/recordings/${recording.id}/playback-token`, { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!cancelled) {
          setError(payload?.error ?? "Unable to open this recording.");
        }
        return;
      }
      const data = (await response.json()) as { streamUrl: string };
      if (!cancelled) {
        setStreamUrl(data.streamUrl);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [recording.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-4xl space-y-3" onContextMenu={(event) => event.preventDefault()}>
        <div className="flex items-start justify-between gap-4 text-white">
          <div>
            <p className="text-sm font-semibold">{recording.courseTitle}</p>
            <p className="text-xs text-white/70">
              {recording.classTitle}
              {recording.classStartsAt
                ? ` • ${new Date(recording.classStartsAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {streamUrl ? (
          <video
            key={streamUrl}
            src={streamUrl}
            controls
            autoPlay
            playsInline
            preload="metadata"
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(event) => event.preventDefault()}
            className="aspect-video w-full rounded-xl bg-black"
          />
        ) : !error ? (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black text-sm text-white/70">
            Opening recording...
          </div>
        ) : null}
        <p className="text-xs text-white/60">
          Recordings are for enrolled students only and are deleted 7 days after the class. Please do
          not record or share them.
        </p>
      </div>
    </div>
  );
}

/**
 * The class recordings the signed-in user may watch (their enrolled courses as
 * a student, their own courses as a tutor). Rendered inside My classes.
 */
export default function ClassRecordings({ userId }: { userId: string }) {
  const [loaded, setLoaded] = useState<{ forUserId: string | null; list: RecordingSummary[] }>({
    forUserId: null,
    list: [],
  });
  const recordings = loaded.forUserId === userId ? loaded.list : [];
  const [selected, setSelected] = useState<RecordingSummary | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch("/api/recordings");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { recordings?: RecordingSummary[] };
      if (!cancelled) {
        setLoaded({ forUserId: userId, list: data.recordings ?? [] });
        setNowMs(Date.now());
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const close = useCallback(() => setSelected(null), []);

  if (recordings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
        Class recordings
      </p>
      <p className="text-xs text-[var(--muted)]">
        Recorded with YanLearn Recorder. Each recording is available for 7 days after the class.
      </p>
      <div className="space-y-2">
        {recordings.map((recording) => (
          <div
            key={recording.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-2"
          >
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">{recording.courseTitle}</p>
              <p className="text-xs text-[var(--muted)]">
                {recording.classTitle}
                {recording.classStartsAt ? (
                  <>
                    <span className="mx-1">•</span>
                    {new Date(recording.classStartsAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </>
                ) : null}
                {recording.durationSeconds ? (
                  <>
                    <span className="mx-1">•</span>
                    {formatDuration(recording.durationSeconds)}
                  </>
                ) : null}
              </p>
              <p className="text-[11px] text-[var(--muted)]">{formatExpiry(recording.expiresAt, nowMs)}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(recording)}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Watch
            </button>
          </div>
        ))}
      </div>
      {selected ? <RecordingPlayer recording={selected} onClose={close} /> : null}
    </div>
  );
}
