"use client";

import { useCallback, useEffect, useState } from "react";
import { broadcastAuthChange } from "@/lib/authClient";

type WithdrawalRequest = {
  id: string;
  hours: number;
  status: "pending" | "fulfilled" | "declined";
  created_at: string;
  resolved_at: string | null;
};

type CompletedWithdrawal = {
  id: string;
  hours: number;
  start_date: string;
  end_date: string;
  created_at: string;
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const statusChipClass: Record<WithdrawalRequest["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  fulfilled: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  declined: "border-red-500/30 bg-red-500/10 text-red-500",
};

/**
 * Tutor-facing card to request community-service-hour withdrawals. Submitting
 * notifies the COO in the founders Discord channel; a pending request is then
 * fulfilled or declined by an admin in the "Withdraw hours" dashboard.
 * Requires the tutor's legal name — guides them through setting it inline.
 */
export default function RequestWithdrawalCard() {
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [availableHours, setAvailableHours] = useState(0);
  const [withdrawnHours, setWithdrawnHours] = useState(0);
  const [legalNameSet, setLegalNameSet] = useState(true);
  const [gradeSet, setGradeSet] = useState(true);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<CompletedWithdrawal[]>([]);
  const [hoursInput, setHoursInput] = useState("");
  const [legalNameDraft, setLegalNameDraft] = useState("");
  const [gradeDraft, setGradeDraft] = useState("");
  const [isSavingLegalName, setIsSavingLegalName] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadData = useCallback(async () => {
    const response = await fetch("/api/withdrawal-requests");
    if (response.status === 403) {
      setIsForbidden(true);
      setIsLoading(false);
      return;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setErrorMsg(payload?.error ?? "Unable to load withdrawal information.");
      setIsLoading(false);
      return;
    }
    const data = (await response.json()) as {
      availableHours?: number;
      withdrawnHours?: number;
      legalNameSet?: boolean;
      gradeSet?: boolean;
      requests?: WithdrawalRequest[];
      withdrawals?: CompletedWithdrawal[];
    };
    setAvailableHours(data.availableHours ?? 0);
    setWithdrawnHours(data.withdrawnHours ?? 0);
    setLegalNameSet(data.legalNameSet ?? true);
    setGradeSet(data.gradeSet ?? true);
    setRequests(data.requests ?? []);
    setWithdrawals(data.withdrawals ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pendingRequest = requests.find((r) => r.status === "pending") ?? null;

  const saveLegalName = async () => {
    const nextName = legalNameDraft.trim();
    if (!nextName) {
      setErrorMsg("Please enter your legal name.");
      return;
    }

    setIsSavingLegalName(true);
    setErrorMsg("");

    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legalName: nextName }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setErrorMsg(payload?.error ?? "Unable to update legal name.");
      setIsSavingLegalName(false);
      return;
    }

    setLegalNameSet(true);
    setIsSavingLegalName(false);
    setSuccessMsg("Legal name saved. You can now submit your withdrawal request.");
    broadcastAuthChange();
  };

  const saveGrade = async () => {
    const grade = gradeDraft.trim();
    if (!/^(9|10|11|12)$/.test(grade)) {
      setErrorMsg("Please select your current grade.");
      return;
    }

    setIsSavingGrade(true);
    setErrorMsg("");

    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setErrorMsg(payload?.error ?? "Unable to update grade.");
      setIsSavingGrade(false);
      return;
    }

    setGradeSet(true);
    setIsSavingGrade(false);
    setSuccessMsg("Grade saved. You can now submit your withdrawal request.");
    broadcastAuthChange();
  };

  const submitRequest = async () => {
    setErrorMsg("");
    setSuccessMsg("");

    const hours = Number.parseFloat(hoursInput);
    if (Number.isNaN(hours) || hours <= 0) {
      setErrorMsg("Please enter a valid positive number of hours.");
      return;
    }
    if (hours % 1.5 !== 0) {
      setErrorMsg("Requested hours must be a multiple of 1.5 hours.");
      return;
    }
    if (hours > availableHours) {
      setErrorMsg(`You only have ${availableHours} withdrawable hours available.`);
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/withdrawal-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; code?: string; discordNotified?: boolean }
      | null;

    if (!response.ok) {
      if (payload?.code === "missing_legal_name") {
        setLegalNameSet(false);
        setErrorMsg("");
      } else if (payload?.code === "missing_grade") {
        setGradeSet(false);
        setErrorMsg("");
      } else {
        setErrorMsg(payload?.error ?? "Could not submit the withdrawal request.");
      }
      setIsSubmitting(false);
      return;
    }

    setSuccessMsg(
      payload?.discordNotified === false
        ? "Request saved. The Discord notification could not be sent — please message the COO directly."
        : "Request sent — the COO has been notified on Discord."
    );
    setHoursInput("");
    setIsSubmitting(false);
    await loadData();
  };

  if (isForbidden || isLoading) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">
          Request hour withdrawal
        </p>
        <p className="text-xs text-[var(--muted)]">
          <span className="font-semibold text-[var(--foreground)]">{availableHours}</span> hours
          withdrawable
          {withdrawnHours > 0 ? ` · ${withdrawnHours} withdrawn` : ""}
        </p>
      </div>

      {errorMsg ? <p className="text-xs text-red-500">{errorMsg}</p> : null}
      {successMsg ? <p className="text-xs text-emerald-500">{successMsg}</p> : null}

      {pendingRequest ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
            Pending
          </span>
          <p className="text-xs text-[var(--foreground)]">
            {Number(pendingRequest.hours)} hours requested on {formatDate(pendingRequest.created_at)}.
            The COO has been notified and will process it soon.
          </p>
        </div>
      ) : !legalNameSet ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3">
          <p className="text-xs text-[var(--foreground)]">
            Your <span className="font-semibold">legal name</span> is required for
            community-service-hour records before you can request a withdrawal.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={legalNameDraft}
              onChange={(event) => setLegalNameDraft(event.target.value)}
              placeholder="Your full legal name"
              className="min-w-[12rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <button
              type="button"
              disabled={isSavingLegalName}
              onClick={saveLegalName}
              className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSavingLegalName ? "Saving..." : "Save legal name"}
            </button>
          </div>
        </div>
      ) : !gradeSet ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-3">
          <p className="text-xs text-[var(--foreground)]">
            Your <span className="font-semibold">current grade</span> appears on the community
            service form (Grade 9&ndash;12 checkboxes). Please set it before requesting a
            withdrawal.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={gradeDraft}
              onChange={(event) => setGradeDraft(event.target.value)}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            >
              <option value="">-- Select grade --</option>
              <option value="9">Grade 9</option>
              <option value="10">Grade 10</option>
              <option value="11">Grade 11</option>
              <option value="12">Grade 12</option>
            </select>
            <button
              type="button"
              disabled={isSavingGrade}
              onClick={saveGrade}
              className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSavingGrade ? "Saving..." : "Save grade"}
            </button>
          </div>
        </div>
      ) : availableHours <= 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No hours available to withdraw yet. Hours become withdrawable after you teach classes
          (1.5 hours per class).
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            step={1.5}
            min={1.5}
            max={availableHours}
            value={hoursInput}
            onChange={(event) => setHoursInput(event.target.value)}
            placeholder={`Hours (multiple of 1.5, up to ${availableHours})`}
            className="min-w-[14rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
          />
          <button
            type="button"
            disabled={isSubmitting}
            onClick={submitRequest}
            className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Submitting..." : "Request withdrawal"}
          </button>
        </div>
      )}

      {withdrawals.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Completed withdrawals
          </p>
          <div className="space-y-1">
            {withdrawals.map((withdrawal) => (
              <div
                key={withdrawal.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5"
              >
                <p className="text-xs text-[var(--foreground)]">
                  {Number(withdrawal.hours)} hours · {formatDate(withdrawal.start_date)} &ndash;{" "}
                  {formatDate(withdrawal.end_date)}
                </p>
                <a
                  href={`/api/withdrawals/${withdrawal.id}/certificate`}
                  download
                  className="rounded-full border border-[var(--foreground)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                >
                  Download form
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {requests.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Request history
          </p>
          <div className="space-y-1">
            {requests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5"
              >
                <p className="text-xs text-[var(--foreground)]">
                  {Number(request.hours)} hours · requested {formatDate(request.created_at)}
                  {request.resolved_at ? ` · resolved ${formatDate(request.resolved_at)}` : ""}
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClass[request.status]}`}
                >
                  {request.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
