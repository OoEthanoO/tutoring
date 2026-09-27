"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Which tutors have YanLearn Recorder open and connected, what it is doing,
 * and which version it is on. Founder trio only (api/admin/recorder-status);
 * the rules are in src/lib/recorderPresence.ts.
 */

type Device = {
  deviceName: string;
  platform: string;
  appVersion: string | null;
  stateLabel: string;
  connected: boolean;
  lastSeenAt: string;
  currentClassTitle: string | null;
  outdated: boolean;
};

type TutorStatus = {
  tutorId: string;
  name: string;
  email: string;
  connected: boolean;
  lastSeenAt: string | null;
  outdated: boolean;
  devices: Device[];
};

type StatusResponse = {
  latestVersion: string | null;
  generatedAt: string;
  tutorCount: number;
  connectedCount: number;
  tutors: TutorStatus[];
  error?: string;
};

type Filter = "all" | "connected" | "offline" | "outdated";

const REFRESH_MS = 20_000;

const ago = (iso: string, nowMs: number) => {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const platformName = (platform: string) =>
  platform === "macos" ? "macOS" : platform === "windows" ? "Windows" : platform || "Unknown system";

export default function AdminRecorderStatus() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/recorder-status", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as StatusResponse | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Could not load recorder status.");
      }
      setData(payload);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load recorder status.");
    } finally {
      setNowMs(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const tutors = (data?.tutors ?? []).filter((tutor) =>
    filter === "connected"
      ? tutor.connected
      : filter === "offline"
        ? !tutor.connected
        : filter === "outdated"
          ? tutor.outdated
          : true
  );
  const outdatedCount = (data?.tutors ?? []).filter((tutor) => tutor.outdated).length;

  return (
    <section className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6">
      <header className="space-y-2">
        <h2 className="text-xl font-bold">YanLearn Recorder</h2>
        <p className="text-sm text-[var(--muted)]">
          Which tutors have the recorder open and connected right now, what it is doing, and which
          version it is on. A recorder counts as connected when it has checked in within the last
          90 seconds; one that is closed, asleep or offline stops checking in, so those look the
          same. Refreshes every 20 seconds.
        </p>
      </header>

      {data ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <p>
            <span className="font-semibold">{data.connectedCount}</span> of {data.tutorCount} tutors connected
          </p>
          <p>
            Latest release: <span className="font-semibold">{data.latestVersion ?? "unknown"}</span>
            {outdatedCount > 0 ? (
              <span className="text-amber-700 dark:text-amber-300"> · {outdatedCount} on an older version</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All tutors"],
            ["connected", "Connected"],
            ["offline", "Not connected"],
            ["outdated", "Older version"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              filter === key
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
        <button type="button" className="ml-auto text-sm underline" onClick={() => void load()}>
          Refresh now
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {!data && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}

      {data && tutors.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No tutors to show.</p>
      ) : null}

      <ul className="space-y-3">
        {tutors.map((tutor) => (
          <li key={tutor.tutorId} className="space-y-2 rounded-xl border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{tutor.name}</p>
                <p className="text-xs text-[var(--muted)]">{tutor.email}</p>
              </div>
              {tutor.connected ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Connected
                </span>
              ) : tutor.lastSeenAt ? (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-semibold text-[var(--muted)]">
                  Not connected · last seen {ago(tutor.lastSeenAt, nowMs)}
                </span>
              ) : (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                  Never signed in
                </span>
              )}
            </div>
            {tutor.devices.length > 0 ? (
              <ul className="space-y-1">
                {tutor.devices.map((device, index) => (
                  <li key={`${tutor.tutorId}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className={device.connected ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"}>
                      {device.deviceName}
                    </span>
                    <span className="text-[var(--muted)]">{platformName(device.platform)}</span>
                    <span
                      className={
                        device.outdated
                          ? "font-semibold text-amber-700 dark:text-amber-300"
                          : "text-[var(--muted)]"
                      }
                    >
                      {device.appVersion ? `v${device.appVersion}` : "version unknown"}
                      {device.outdated ? " · older than the latest" : ""}
                    </span>
                    {device.connected ? (
                      <span className="text-[var(--foreground)]">
                        {device.stateLabel}
                        {device.currentClassTitle ? ` — ${device.currentClassTitle}` : ""}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">last seen {ago(device.lastSeenAt, nowMs)}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
