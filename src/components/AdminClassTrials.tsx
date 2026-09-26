"use client";

import { useCallback, useEffect, useState } from "react";
import { trialStatus, trialWindow, type ClassTrial, type TrialLesson } from "@/lib/classTrials";

const invite = process.env.NEXT_PUBLIC_DISCORD_SERVER_INVITE_URL || "https://discord.gg/yDMdWcs64R";
const dateTime = (value: string | number) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";

export default function AdminClassTrials() {
  const [trials, setTrials] = useState<ClassTrial[]>([]);
  const [classes, setClasses] = useState<TrialLesson[]>([]);
  const [classId, setClassId] = useState("");
  const [name, setName] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/class-trials");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load trials.");
      setTrials(data.trials); setClasses(data.classes); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load trials."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/class-trials", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, discordUserId: discordId, studentName: name, replaceApprovedAccount: replace }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the trial.");
      setName(""); setDiscordId(""); setReplace(false);
      setNotice("Trial saved. Discord access updates on the next sync. Share the server invite and class time with the student.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the trial."); }
    finally { setBusy(false); }
  };
  const revoke = async (trial: ClassTrial) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/class-trials", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: trial.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke the trial.");
      setNotice("Trial revoked. Discord access is removed on the next sync."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke the trial."); }
    finally { setBusy(false); }
  };
  const selected = classes.find(c => c.id === classId);
  const window = trialWindow(selected ?? null);
  const visible = trials.filter(t => showHistory || ["scheduled", "open"].includes(trialStatus(t, now)))
    .sort((a, b) => (a.lesson?.starts_at ?? "").localeCompare(b.lesson?.starts_at ?? ""));
  return <section className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6">
    <header><h2 className="text-xl font-bold">Trial classes</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Book one class using the student&apos;s own name and Discord ID. No YanLearn account is required. Trial access covers only that class&apos;s course chat, voice channel and breakout rooms.</p>
      <p className="mt-2 text-sm text-[var(--muted)]">Access opens 5 minutes before class and ends 30 minutes after its scheduled end. Guests can join the server once booked; unlinked guests leave the server when their last trial expires or is revoked. Regular enrollments stay unchanged.</p>
    </header>
    <form onSubmit={save} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm sm:col-span-2">Scheduled class<select aria-label="Scheduled class" className={field} required value={classId} onChange={e => setClassId(e.target.value)} disabled={loading || busy}>
        <option value="">Choose a class</option>{classes.filter(c => (trialWindow(c)?.expiresAtMs ?? 0) > now).map(c => <option key={c.id} value={c.id}>{c.course?.title} — {c.title} — {dateTime(c.starts_at)}</option>)}
      </select></label>
      <label className="space-y-1 text-sm">Student name<input aria-label="Student name" className={field} value={name} onChange={e => setName(e.target.value)} maxLength={100} required disabled={busy} /></label>
      <label className="space-y-1 text-sm">Discord user ID<input aria-label="Discord user ID" className={field} value={discordId} onChange={e => setDiscordId(e.target.value)} inputMode="numeric" pattern="[0-9]{17,20}" required disabled={busy} /></label>
      <p className="text-xs text-[var(--muted)] sm:col-span-2">In Discord, enable Settings → Advanced → Developer Mode, then right-click the student and choose Copy User ID.</p>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} disabled={busy} className="mt-1" />Replace this person&apos;s existing tutor-linked approval with this trial. This removes the extra account&apos;s access to the tutor&apos;s other courses.</label>
      {window && <p className="text-xs text-[var(--muted)] sm:col-span-2">Access: {dateTime(window.opensAtMs)} to {dateTime(window.expiresAtMs)} (your local time).</p>}
      <button disabled={busy || loading || !classId} className="rounded-full bg-[var(--foreground)] px-5 py-2 text-sm font-semibold text-[var(--background)] disabled:opacity-50">{busy ? "Saving…" : "Add trial student"}</button>
    </form>
    <p className="text-sm">Server invite: <a className="underline" href={invite} target="_blank" rel="noopener noreferrer">{invite}</a></p>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Booked trials</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />Show expired and revoked trials</label><button className="text-sm underline" onClick={load} disabled={busy}>Refresh</button></div>
    {loading ? <p>Loading trials…</p> : visible.length === 0 ? <p className="text-sm text-[var(--muted)]">No trials to show.</p> : <ul className="space-y-3">{visible.map(t => {
      const status = trialStatus(t, now);
      return <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-4"><div><p className="font-semibold">{t.student_name} <span className="text-xs font-normal text-[var(--muted)]">{status === "open" ? "Access open" : status}</span></p><p className="text-sm">{t.lesson?.course?.title} — {t.lesson?.title}</p><p className="text-xs text-[var(--muted)]">{t.lesson ? dateTime(t.lesson.starts_at) : "Class unavailable"} · Discord ID: {t.discord_user_id}</p></div>{["open", "scheduled"].includes(status) && <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm" onClick={() => revoke(t)} disabled={busy}>Revoke trial</button>}</li>;
    })}</ul>}
  </section>;
}
