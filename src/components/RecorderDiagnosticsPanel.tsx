"use client";

import { useEffect, useState } from "react";
import type { DiagnosticReport } from "@/lib/recorderDiagnostics";
import { recorderStateLabel } from "@/lib/recorderPresence";

type Snapshot = { receivedAt: string | null; report: DiagnosticReport | null };

export default function RecorderDiagnosticsPanel({ tutorId, deviceId }: { tutorId: string; deviceId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let closed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const query = new URLSearchParams({ tutorId, deviceId });
        const response = await fetch(`/api/admin/recorder-diagnostics?${query}`, { cache: "no-store", signal: request.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Could not load diagnostics.");
        if (!closed) { setData(payload); setError(""); }
      } catch (failure) {
        if (!closed) setError(failure instanceof Error ? failure.message : "Could not load diagnostics.");
      } finally { clearTimeout(timeout); }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => { closed = true; controller?.abort(); clearInterval(timer); };
  }, [open, tutorId, deviceId]);

  const report = data?.report;
  return <details className="w-full text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer py-1 underline">View diagnostics</summary>
    {open ? <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
      {!data && !error ? <p>Loading diagnostics…</p> : null}
      {data && !report ? <p>No recent diagnostics received. This requires a Recorder version that supports diagnostic reports; older versions cannot send past logs remotely.</p> : null}
      {report ? <>
        <p><strong>{recorderStateLabel(report.state)}</strong> · Report received {data?.receivedAt ? new Date(data.receivedAt).toLocaleString() : "unknown"}.</p>
        <p>Recorder’s last successful server check: {report.lastSuccessfulTickAt ? new Date(report.lastSuccessfulTickAt).toLocaleString() : "none reported"}.</p>
        <p>Recorder’s voice check: {report.inCall === null ? "not available" : report.inCall ? "in the class call" : "outside the class call"}.
          {" "}Capture: {report.capturing ? "running" : "stopped"}{report.frozen ? " (picture frozen)" : ""}.
          {" "}Microphone: {report.muted ? "muted in recording" : "not muted in recording"}.
          {" "}Capture failures: {report.captureFailures}. Segments: {report.segmentCount}. Pending uploads: {report.pendingUploads}.</p>
        <p className="text-[var(--muted)]">Latest reported state, not a live view of their computer. Up to 100 recent Activity entries; refreshed every 30 seconds while open. Reports expire after 7 days.</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 font-mono">{report.logs.length ? report.logs.map((entry) => `[${new Date(entry.at).toLocaleString()}] ${entry.message}`).join("\n") : "No Activity entries in this report."}</pre>
      </> : null}
    </div> : null}
  </details>;
}
