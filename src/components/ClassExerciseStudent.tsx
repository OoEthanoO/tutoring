"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { exerciseCanSubmit, exerciseOpen, exerciseSecondsLeft, type ExerciseState } from "@/lib/classExercises";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7";
const code = "whitespace-pre-wrap break-words font-mono text-sm leading-relaxed [tab-size:4]";
const button = "rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold disabled:opacity-40";

export default function ClassExerciseStudent({ classId }: { classId: string }) {
  const [data, setData] = useState<ExerciseState | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0);
  const clock = useRef({ server: 0, received: 0 });
  const requestId = useRef<{ question: string; answer: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const url = `/api/class-exercises/${classId}`;

  const accept = useCallback((value: ExerciseState) => {
    if (requestId.current && value.submissions.some(s => s.id === requestId.current?.id)) requestId.current = null;
    clock.current = { server: value.serverNow, received: performance.now() };
    setNow(value.serverNow);
    setData(value);
    setOffline(false);
    setUnauthorized(false);
  }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const version = generation.current;
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) { setData(null); setDrafts({}); }
        setUnauthorized(response.status === 401);
        throw new Error(value.error || "Unable to load the question.");
      }
      accept(value);
    } catch (err) {
      if (version === generation.current) {
        setOffline(true);
        setError(err instanceof Error ? err.message : "Connection lost. Reconnecting…");
      }
    } finally { inFlight.current = false; }
  }, [url, accept]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 2000);
    const countdown = setInterval(() => setNow(clock.current.server + performance.now() - clock.current.received), 200);
    return () => {
      clearInterval(poll); clearInterval(countdown);
      // This is a request generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [refresh]);

  const question = data?.questions.find(q => q.id === data.currentQuestionId);
  const attempts = data?.submissions.filter(s => s.question_id === question?.id).sort((a, b) => b.attempt - a.attempt) ?? [];
  const latest = attempts[0];
  const open = exerciseOpen(question, data?.currentQuestionId ?? null, now);
  const remaining = exerciseSecondsLeft(question, data?.currentQuestionId ?? null, now);
  const canSubmit = !!data?.canSubmit && !offline && exerciseCanSubmit(open, latest);
  const answer = question ? drafts[question.id] ?? (latest?.status === "incorrect" ? latest.answer : "") : "";
  const setAnswer = (value: string) => { if (question) setDrafts(previous => ({ ...previous, [question.id]: value })); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!question || !canSubmit || busy) return;
    setBusy(true);
    setError("");
    generation.current++; // An older poll must not overwrite a saved attempt.
    const existing = requestId.current;
    const id = existing?.question === question.id && existing.answer === answer ? existing.id : crypto.randomUUID();
    requestId.current = { question: question.id, answer, id };
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", id, questionId: question.id, answer }),
        signal: AbortSignal.timeout(15000),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Your answer was not submitted. Try again.");
      generation.current++;
      accept(value);
      requestId.current = null;
      setDrafts(previous => { const next = { ...previous }; delete next[question.id]; return next; });
    } catch (err) { setError(err instanceof Error ? err.message : "Your answer was not submitted. Try again."); }
    finally { setBusy(false); void refresh(); }
  };

  return <main className="mx-auto min-h-screen max-w-4xl space-y-6 px-5 py-8 pb-24 text-[var(--foreground)]">
    <nav className="flex items-center justify-between"><Link href="/" className="text-lg font-semibold">YanLearn</Link><span className="text-sm text-[var(--muted)]">Class exercises</span></nav>
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">{data?.courseTitle || "In-class exercises"}</h1>
      {data && <p className="text-[var(--muted)]">{data.classTitle} · {new Date(data.startsAt).toLocaleDateString()}</p>}
      <p className="text-sm text-[var(--muted)]">Keep this page open for every question. Your answers are private to you and your tutors.</p>
    </header>
    {offline && <div role="status" className={card}>{unauthorized ? <><p>Sign in to answer this class&apos;s exercises.</p><Link className={`${button} mt-4 inline-block`} href={`/login?next=${encodeURIComponent(`/class-exercises/${classId}`)}`}>Sign in to YanLearn</Link></> : <><p>{error}</p><p className="mt-2 text-sm text-[var(--muted)]">Submissions are disabled until the connection is restored. Your unsent answer stays here.</p></>}</div>}
    {!data && !offline && <p role="status">Loading class…</p>}
    {data && !question && <section className={card}><h2 className="text-lg font-semibold">Waiting for your tutor</h2><p className="mt-2 text-[var(--muted)]">The first question will appear here when your tutor shares it.</p></section>}
    {question && <section className={`${card} space-y-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 aria-live="polite" className="text-lg font-semibold">Question {question.number}</h2>
        <span role="timer" aria-label={open ? `${remaining} seconds remaining` : "Submissions closed"} className="rounded-full border border-[var(--border)] px-4 py-2 font-mono text-lg tabular-nums">
          {open ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left` : "Submissions closed"}
        </span>
      </div>
      <pre className={code}>{question.prompt}</pre>
      {!open && <p className="text-sm text-[var(--muted)]">This question is frozen. Your tutor can still mark answers and give feedback.</p>}
      {!data?.canSubmit && <p className="text-sm text-[var(--muted)]">Tutor preview. Enrolled students can submit here; manage responses in Recorder.</p>}
      {latest && <div aria-live="polite" className="space-y-2 rounded-xl bg-[var(--surface-muted)] p-4">
        <p className="font-semibold">{latest.status === "correct" ? "Correct — you’re done!" : latest.status === "incorrect" ? "Incorrect — review your tutor’s feedback" : "Answer received — waiting for feedback"}</p>
        {latest.feedback && <pre className={code}>{latest.feedback}</pre>}
        {latest.status === "incorrect" && <p className="text-sm text-[var(--muted)]">{open ? "You can revise your answer and resubmit before the timer ends." : "The timer has ended. No more submissions are allowed for this question."}</p>}
      </div>}
      {data?.canSubmit && <form className="space-y-3" onSubmit={submit}>
        <label className="block font-semibold" htmlFor="exercise-answer">Your answer</label>
        <textarea id="exercise-answer" rows={10} maxLength={30000} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          className={`${code} w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 disabled:opacity-60`}
          value={canSubmit ? answer : (drafts[question.id] ?? latest?.answer ?? answer)} disabled={!canSubmit || busy}
          onChange={event => setAnswer(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Tab" || event.shiftKey) return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart;
            setAnswer(input.value.slice(0, start) + "    " + input.value.slice(input.selectionEnd));
            requestAnimationFrame(() => input.setSelectionRange(start + 4, start + 4));
          }} />
        <p className="text-xs text-[var(--muted)]">Line breaks and indentation are preserved. Tab inserts four spaces; Shift+Tab moves to the previous control.</p>
        <button className={button} disabled={!canSubmit || busy || !answer.trim()}>{busy ? "Submitting…" : latest ? "Resubmit answer" : "Submit answer"}</button>
        {error && !offline && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>}
    </section>}
    {!!data?.submissions.length && <section className="space-y-3"><h2 className="text-lg font-semibold">Your answers & feedback</h2>
      {[...data.submissions].reverse().map(submission => <details key={submission.id} className={card}>
        <summary className="cursor-pointer font-medium">Question {data.questions.find(q => q.id === submission.question_id)?.number} · Attempt {submission.attempt} · {submission.status}</summary>
        <pre className={`${code} mt-4 text-[var(--muted)]`}>{data.questions.find(q => q.id === submission.question_id)?.prompt}</pre>
        <pre className={`${code} mt-4`}>{submission.answer}</pre>
        {submission.feedback && <div className="mt-4 border-t border-[var(--border)] pt-4"><p className="mb-2 font-semibold">Tutor feedback</p><pre className={code}>{submission.feedback}</pre></div>}
      </details>)}
    </section>}
  </main>;
}
