"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_PAYMENT_NOTE_LENGTH, formatPaidFee } from "@/lib/paidCourses";

type PaidRequest = {
  id: string;
  courseId: string;
  courseTitle: string;
  fee: number | null;
  studentName: string;
  guardianName: string | null;
  submittedAt: string;
  paymentConfirmedAt: string | null;
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Senior tutors only (PAID_COURSES.md): the payment note families see on this
 * tutor's paid courses, and the enrollment requests waiting for the tutor to
 * say that the payment arrived. Renders nothing for everyone else.
 */
export default function PaidCoursesCard() {
  const [isSenior, setIsSenior] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [note, setNote] = useState("");
  const [requests, setRequests] = useState<PaidRequest[]>([]);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadRequests = useCallback(async () => {
    try {
      const response = await fetch("/api/paid-enrollments");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { requests?: PaidRequest[] };
      setRequests(data.requests ?? []);
    } catch {
      // The list is retried the next time the page is opened.
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/tutor-profile");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { seniorTutor?: boolean; paymentNote?: string };
        if (!data.seniorTutor) {
          return;
        }
        setIsSenior(true);
        setSavedNote(data.paymentNote ?? "");
        setNote(data.paymentNote ?? "");
        await loadRequests();
      } catch {
        // Without the profile there is nothing to show.
      }
    };
    load();
  }, [loadRequests]);

  const saveNote = async () => {
    setIsSavingNote(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const response = await fetch("/api/tutor-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentNote: note }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; paymentNote?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save the payment note.");
      }
      const saved = payload?.paymentNote ?? "";
      setSavedNote(saved);
      setNote(saved);
      setSuccessMsg(saved ? "Payment note saved." : "Payment note removed.");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Could not save the payment note.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const setReceived = async (target: PaidRequest, received: boolean) => {
    setBusyRequestId(target.id);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const response = await fetch("/api/paid-enrollments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: target.id, received, submittedAt: target.submittedAt }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; request?: { paymentConfirmedAt: string | null } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save the payment status.");
      }
      setRequests((current) =>
        current.map((item) =>
          item.id === target.id
            ? { ...item, paymentConfirmedAt: payload?.request?.paymentConfirmedAt ?? null }
            : item
        )
      );
      setSuccessMsg(
        received
          ? "Marked as received. Management can now approve the enrollment."
          : "Marked as not received."
      );
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Could not save the payment status.");
    } finally {
      setBusyRequestId(null);
    }
  };

  if (!isSenior) {
    return null;
  }

  const noteChanged = note.trim() !== savedNote.trim();

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--foreground)]">Paid courses</p>
        <p className="text-xs text-[var(--muted)]">
          You are a senior tutor, so you can ask for a paid course on a course request. Families
          pay you directly. YanLearn does not receive or hold the money, and a paid course earns
          no community service hours.
        </p>
      </div>

      {errorMsg ? <p role="alert" className="text-xs text-red-500">{errorMsg}</p> : null}
      {successMsg ? <p role="status" className="text-xs text-emerald-500">{successMsg}</p> : null}

      <div className="space-y-2">
        <label htmlFor="paid-courses-payment-note" className="text-xs font-semibold text-[var(--foreground)]">
          Your payment note
        </label>
        <p className="text-xs text-[var(--muted)]">
          How a family pays you, for example the address for an Interac e-Transfer. Signed-in
          families see it when they enroll in one of your paid courses. Never put a password or a
          card number here.
        </p>
        <textarea
          id="paid-courses-payment-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={MAX_PAYMENT_NOTE_LENGTH}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isSavingNote || !noteChanged}
            onClick={saveNote}
            className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingNote ? "Saving..." : "Save payment note"}
          </button>
          {!savedNote ? (
            <p className="text-xs text-amber-600">
              A course cannot become a paid course until you have saved a payment note.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">Payments to confirm</p>
        {requests.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            No enrollment requests are waiting on your paid courses.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((item) => {
              const isBusy = busyRequestId === item.id;
              return (
                <li
                  key={item.id}
                  className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3"
                >
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-[var(--foreground)]">
                      {item.courseTitle}
                      {item.fee !== null ? ` · ${formatPaidFee(item.fee)}` : ""}
                    </p>
                    <p className="text-xs text-[var(--foreground)]">Student: {item.studentName}</p>
                    {item.guardianName ? (
                      <p className="text-xs text-[var(--foreground)]">
                        Parent or guardian: {item.guardianName}
                      </p>
                    ) : null}
                    <p className="text-xs text-[var(--muted)]">Requested {formatDate(item.submittedAt)}</p>
                  </div>
                  {item.paymentConfirmedAt ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                        Payment received
                      </span>
                      <p className="text-xs text-[var(--muted)]">Waiting for management to approve.</p>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setReceived(item, false)}
                        className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Saving..." : "Undo"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setReceived(item, true)}
                        className="rounded-full border border-[var(--foreground)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Saving..." : "Payment received"}
                      </button>
                      <p className="text-xs text-[var(--muted)]">
                        Press this only after the money is in your account.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
