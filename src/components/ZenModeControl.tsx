"use client";
import { useEffect, useState } from "react";

export default function ZenModeControl({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/courses/${courseId}/zen-mode`;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled && !busy) {
          if (!response.ok) throw new Error(data.error || "Could not load Zen mode.");
          setEnabled(data.enabled); setError("");
        }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load Zen mode."); }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [url, busy]);
  const toggle = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update Zen mode.");
      setEnabled(data.enabled);
      setNotice(data.problems?.length ? `Saved, but Discord has not fully applied the change: ${data.problems.join(" ")} It will retry automatically.`
        : `Zen mode ${data.enabled ? "enabled" : "disabled"} for this course's current and remaining classes.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update Zen mode."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 rounded-xl border border-[var(--border)] px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold">{courseTitle} · Zen mode</p>
      <button type="button" role="switch" aria-label={`Zen mode for ${courseTitle}`} aria-checked={enabled === true} disabled={busy || enabled === null}
        onClick={toggle} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold disabled:opacity-50">
        {busy ? "Applying…" : enabled === null ? "Loading…" : enabled ? "On — turn off" : "Off — turn on"}
      </button>
    </div>
    <p className="text-xs text-[var(--muted)]">Students listen and use the course text channel. Applies to this course&apos;s current and remaining classes, including breakout rooms. You can change it during a class.</p>
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="text-xs text-[var(--muted)]">{notice}</p>}
  </div>;
}
