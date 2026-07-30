"use client";

import React, { useEffect, useState } from "react";
import { sumHours, withdrawableHourSteps } from "@/lib/serviceHours";

type Tutor = {
  id: string;
  name: string;
  generation: string | null;
  role: string;
};

type CourseClass = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
  course_id: string;
  course_title: string;
  course_grade_level: number | null;
  // Service hours this class earns the tutor: 2 for grade 11/12 courses, else 1.5.
  service_hours: number;
  tutor_withdrawal_id: string | null;
};

type TutorWithdrawal = {
  id: string;
  hours: number;
  start_date: string;
  end_date: string;
  created_at: string;
};

type GlobalWithdrawal = {
  id: string;
  tutor_id: string;
  hours: number;
  start_date: string;
  end_date: string;
  created_at: string;
  tutor_legal_name: string;
  tutor?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

type TutorInfo = {
  id: string;
  fullName: string | null;
  legalName: string | null;
  email: string | null;
};

type PendingRequest = {
  id: string;
  tutor_id: string;
  tutor_legal_name: string;
  hours: number;
  created_at: string;
  tutor?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

export default function WithdrawHoursMenu() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [selectedTutorId, setSelectedTutorId] = useState<string>("");
  const [classes, setClasses] = useState<CourseClass[]>([]);
  const [tutorWithdrawals, setTutorWithdrawals] = useState<TutorWithdrawal[]>([]);
  const [globalWithdrawals, setGlobalWithdrawals] = useState<GlobalWithdrawal[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [decliningRequestId, setDecliningRequestId] = useState<string | null>(null);
  const [tutorInfo, setTutorInfo] = useState<TutorInfo | null>(null);
  const [hoursToWithdraw, setHoursToWithdraw] = useState<string>("");
  const [previewData, setPreviewData] = useState<{
    startDate: string;
    endDate: string;
    hours: number;
    numClasses: number;
    tutorLegalName?: string;
  } | null>(null);

  const [step, setStep] = useState<"input" | "preview" | "success">("input");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  useEffect(() => {
    const fetchTutors = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/tutors");
        if (res.ok) {
          const data = await res.json();
          setTutors(data.tutors || []);
        } else {
          setErrorMsg("Failed to load tutors list.");
        }
      } catch {
        setErrorMsg("Network error loading tutors.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchTutors();
    loadGlobalWithdrawals();
  }, []);

  const loadGlobalWithdrawals = async () => {
    try {
      const res = await fetch("/api/admin/withdrawals"); // No tutorId, fetches all
      if (res.ok) {
        const data = await res.json();
        setGlobalWithdrawals(data.withdrawals || []);
        setPendingRequests(data.pendingRequests || []);
      }
    } catch (err) {
      console.error("Failed to load global withdrawals", err);
    }
  };

  const loadTutorData = async (tutorId: string) => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/admin/withdrawals?tutorId=${tutorId}`);
      if (res.ok) {
        const data = await res.json();
        setClasses(data.classes || []);
        setTutorWithdrawals(data.withdrawals || []);
        setTutorInfo(data.tutor || null);
      } else {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.error || "Failed to load tutor data.");
      }
    } catch {
      setErrorMsg("Network error loading tutor details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTutorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedTutorId(id);
    setHoursToWithdraw("");
    setPreviewData(null);
    setTutorInfo(null);
    setStep("input");
    setErrorMsg("");
    setSuccessMsg("");
    if (id) {
      loadTutorData(id);
    } else {
      setClasses([]);
      setTutorWithdrawals([]);
    }
  };

  // Drop the admin into the normal withdrawal flow with the request pre-filled.
  const reviewRequest = (request: PendingRequest) => {
    setSelectedTutorId(request.tutor_id);
    setHoursToWithdraw(String(Number(request.hours)));
    setPreviewData(null);
    setTutorInfo(null);
    setStep("input");
    setErrorMsg("");
    setSuccessMsg("");
    loadTutorData(request.tutor_id);
  };

  const declineRequest = async (request: PendingRequest) => {
    const tutorLabel =
      request.tutor?.full_name || request.tutor?.email || request.tutor_legal_name || "this tutor";
    const confirmed = window.confirm(
      `Decline the ${Number(request.hours)}-hour withdrawal request from ${tutorLabel}?`
    );
    if (!confirmed) {
      return;
    }

    setDecliningRequestId(request.id);
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, status: "declined" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.error || "Failed to decline the request.");
      } else {
        await loadGlobalWithdrawals();
      }
    } catch {
      setErrorMsg("Network error declining the request.");
    } finally {
      setDecliningRequestId(null);
    }
  };

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTutorId) return;

    setErrorMsg("");
    const hours = Number.parseFloat(hoursToWithdraw);

    if (Number.isNaN(hours) || hours <= 0) {
      setErrorMsg("Please select the amount of hours to withdraw.");
      return;
    }

    if (!availableHourSteps.some((step) => Math.abs(step - hours) < 1e-9)) {
      setErrorMsg(
        "Withdrawals cover whole classes — pick one of the listed amounts."
      );
      return;
    }

    // Double check legal name on client side
    if (tutorInfo && !tutorInfo.legalName) {
      setErrorMsg("Cannot preview: Tutor must have their legal name set.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tutorId: selectedTutorId,
          hours: hours,
          confirm: false,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPreviewData(data);
        setStep("preview");
      } else {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.error || "Validation failed.");
      }
    } catch {
      setErrorMsg("Network error verifying withdrawal.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedTutorId || !previewData) return;

    setIsLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tutorId: selectedTutorId,
          hours: previewData.hours,
          confirm: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccessMsg(`Hours successfully withdrawn! Added a past withdrawal record of ${data.withdrawal.hours} hours.`);
        setStep("success");
        // Reload fresh details and history list
        await loadTutorData(selectedTutorId);
        await loadGlobalWithdrawals();
      } else {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.error || "Withdrawal failed.");
        if (res.status === 409) {
          // Another withdrawal claimed these classes — the preview is stale.
          setPreviewData(null);
          setStep("input");
          await loadTutorData(selectedTutorId);
        }
      }
    } catch {
      setErrorMsg("Network error confirming withdrawal.");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setHoursToWithdraw("");
    setPreviewData(null);
    setStep("input");
    setErrorMsg("");
    setSuccessMsg("");
  };

  const selectedTutor = tutors.find((t) => t.id === selectedTutorId);

  // Filter lessons taught (past or current classes)
  const now = new Date();
  const lessonsTaught = classes.filter((c) => new Date(c.starts_at) <= now);
  const futureLessons = classes.filter((c) => new Date(c.starts_at) > now);

  const totalClassesTaughtCount = lessonsTaught.length;
  const withdrawnClassesCount = lessonsTaught.filter((c) => c.tutor_withdrawal_id !== null).length;
  // Oldest-first, matching the order the server consumes them in.
  const availableLessons = lessonsTaught.filter((c) => c.tutor_withdrawal_id === null);
  const availableClassesCount = availableLessons.length;

  const totalHoursTaught = sumHours(lessonsTaught.map((c) => Number(c.service_hours) || 0));
  // Past withdrawals are read from their records, not recomputed, so the figures
  // keep matching the forms that were already issued.
  const totalHoursWithdrawn = sumHours(tutorWithdrawals.map((w) => Number(w.hours) || 0));
  const availableHourSteps = withdrawableHourSteps(
    availableLessons.map((c) => Number(c.service_hours) || 0)
  );
  const availableHours = availableHourSteps.length
    ? availableHourSteps[availableHourSteps.length - 1]
    : 0;

  // "Review & prefill" copies a tutor's requested amount into the form, but that
  // amount only lands on a class boundary if their available classes still add up
  // to it — grade levels change and classes get withdrawn in between.
  const prefilledHours = Number.parseFloat(hoursToWithdraw);
  const isPrefillUnavailable =
    Number.isFinite(prefilledHours) &&
    availableHourSteps.length > 0 &&
    !availableHourSteps.some((step) => Math.abs(step - prefilledHours) < 1e-9);

  const isLegalNameMissing = selectedTutorId && tutorInfo && !tutorInfo.legalName;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Hours management
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Withdraw community service hours
        </h2>
        <p className="text-xs text-[var(--muted)] max-w-2xl">
          Help tutors withdraw their community service hours. Each lesson taught counts as 1.5 hours, or 2 hours when the course is set to grade 11 or 12. Withdrawals must start chronologically from the oldest available class. Legal names are required to perform withdrawals.
        </p>
      </header>

      {/* Select Tutor Dropdown */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Select Tutor
        </label>
        <select
          value={selectedTutorId}
          onChange={handleTutorChange}
          disabled={isLoading && tutors.length === 0}
          className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] shadow-sm outline-none transition focus:border-[var(--foreground)]/30"
        >
          <option value="">-- Choose a tutor --</option>
          {tutors.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.role}) {t.generation ? `• Gen ${t.generation}` : ""}
            </option>
          ))}
        </select>
      </div>

      {errorMsg ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 px-4 py-3 text-xs text-red-700 dark:border-red-950/50 dark:bg-red-950/30 dark:text-red-400">
          {errorMsg}
        </div>
      ) : null}

      {/* Pending tutor-initiated withdrawal requests */}
      {pendingRequests.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">
            Pending withdrawal requests ({pendingRequests.length})
          </p>
          <div className="space-y-2">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {request.tutor?.full_name || request.tutor?.email || "Unknown tutor"}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Legal name: {request.tutor_legal_name || "—"} · {Number(request.hours)} hours ·
                    requested{" "}
                    {new Date(request.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => reviewRequest(request)}
                    className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                  >
                    Review & prefill
                  </button>
                  <button
                    type="button"
                    disabled={decliningRequestId === request.id}
                    onClick={() => declineRequest(request)}
                    className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {decliningRequestId === request.id ? "Declining..." : "Decline"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Legal Name Requirement Warning Box */}
      {isLegalNameMissing && tutorInfo ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 px-5 py-4 text-red-900 dark:border-red-950/50 dark:bg-red-950/20 dark:text-red-400 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <svg className="h-5 w-5 text-red-600 dark:text-red-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Withdrawals Blocked: Missing Legal Name
          </div>
          <p className="text-xs">
            Tutor <strong>{tutorInfo.fullName || tutorInfo.email}</strong> does not have their legal name set. Legal names are now required at the time of withdrawal. The tutor must register their legal name in their settings before hours can be withdrawn.
          </p>
        </div>
      ) : null}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Panel: Tutor summary or Select prompt */}
        <div className="lg:col-span-2 space-y-6">
          {selectedTutorId && selectedTutor ? (
            <>
              {/* Tutor Status Grid */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-center animate-in fade-in duration-300">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Lessons Taught
                  </p>
                  <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">
                    {totalClassesTaughtCount}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    ({totalHoursTaught} total hrs)
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-center animate-in fade-in duration-300">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Withdrawn
                  </p>
                  <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-500">
                    {withdrawnClassesCount}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    ({totalHoursWithdrawn} hrs)
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-center animate-in fade-in duration-300">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Available
                  </p>
                  <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-500">
                    {availableClassesCount}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    ({availableHours} hrs)
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-center animate-in fade-in duration-300">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Future Lessons
                  </p>
                  <p className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-500">
                    {futureLessons.length}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    (not eligible yet)
                  </p>
                </div>
              </div>

              {/* Steps Container (Hidden if legal name is missing to prevent actions) */}
              {!isLegalNameMissing ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
                  {step === "input" && (
                    <form onSubmit={handlePreview} className="space-y-4">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-[var(--foreground)]">
                          New Hour Withdrawal
                        </h3>
                        <p className="text-xs text-[var(--muted)]">
                          Pick the total amount of hours to withdraw. Amounts cover whole
                          classes, taken oldest first.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-full max-w-[260px]">
                          <select
                            required
                            value={hoursToWithdraw}
                            onChange={(e) => setHoursToWithdraw(e.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]/30"
                          >
                            <option value="">-- Hours to withdraw --</option>
                            {availableHourSteps.map((step, index) => (
                              <option key={step} value={step}>
                                {step} hours ({index + 1} lesson{index === 0 ? "" : "s"})
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="submit"
                          disabled={isLoading || availableHours <= 0}
                          className="rounded-xl bg-[var(--foreground)] px-5 py-2 text-xs font-semibold text-[var(--background)] hover:bg-[var(--foreground)]/90 transition disabled:bg-[var(--border)] disabled:text-[var(--muted)]"
                        >
                          {isLoading ? "Verifying..." : "Verify & Preview"}
                        </button>
                      </div>
                      {availableHours <= 0 ? (
                        <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                          Tutor has no available hours to withdraw at this time.
                        </p>
                      ) : isPrefillUnavailable ? (
                        <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                          The requested {prefilledHours} hours does not add up to a whole
                          number of this tutor&apos;s available classes. Pick the closest
                          amount above instead.
                        </p>
                      ) : null}
                    </form>
                  )}

                  {step === "preview" && previewData && (
                    <div className="space-y-5 animate-in fade-in duration-300">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-500 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                          Verify Withdrawal Preview
                        </h3>
                        <p className="text-xs text-[var(--muted)]">
                          Please review the chronological details of the classes that will be marked as withdrawn:
                        </p>
                      </div>

                      <div className="rounded-xl border border-amber-100 bg-amber-50/20 p-5 dark:border-amber-950/40 dark:bg-amber-950/10 grid grid-cols-1 gap-4 sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                            Tutor Legal Name
                          </p>
                          <p className="mt-0.5 text-sm font-bold text-[var(--foreground)]">
                            {previewData.tutorLegalName || "Not Set"}
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                            Start Class Date
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">
                            {formatDate(previewData.startDate)}
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                            End Class Date
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">
                            {formatDate(previewData.endDate)}
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                            Total Hours
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">
                            {previewData.hours} hrs ({previewData.numClasses} lessons)
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleConfirm}
                          disabled={isLoading}
                          className="rounded-xl bg-green-600 hover:bg-green-700 px-5 py-2 text-xs font-semibold text-white transition disabled:bg-[var(--border)]"
                        >
                          {isLoading ? "Confirming..." : "Confirm & Save"}
                        </button>

                        <button
                          type="button"
                          onClick={resetForm}
                          disabled={isLoading}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/20 px-5 py-2 text-xs font-semibold text-[var(--foreground)] transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {step === "success" && (
                    <div className="space-y-4 animate-in zoom-in-95 duration-300">
                      <div className="rounded-full bg-green-100 dark:bg-green-950/30 p-2.5 w-fit">
                        <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-base font-bold text-green-600 dark:text-green-500">
                          Withdrawal Finalized
                        </h3>
                        <p className="text-xs text-[var(--muted)]">
                          The withdrawal record has been permanently added to the tutor&apos;s history, and the associated lessons have been locked under their legal name.
                        </p>
                      </div>

                      <div className="rounded-xl border border-green-100 bg-green-50/20 p-4 text-xs font-medium text-green-800 dark:border-green-950/40 dark:bg-green-950/10 dark:text-green-300">
                        <div>{successMsg}</div>
                        {tutorInfo?.legalName && (
                          <div className="mt-1.5 font-bold text-[9px] uppercase tracking-wider text-[var(--muted)]">
                            Locked Legal Name: {tutorInfo.legalName}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-xl bg-[var(--foreground)] px-5 py-2 text-xs font-semibold text-[var(--background)] hover:bg-[var(--foreground)]/90 transition"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Timeline of classes */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    Timeline of Lessons
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Complete history of lessons scheduled and taught. Oldest lessons are at the top.
                  </p>
                </div>

                {classes.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] italic">
                    No lessons found for this tutor.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {classes.map((cls) => {
                      const isFuture = new Date(cls.starts_at) > now;
                      const isWithdrawn = cls.tutor_withdrawal_id !== null;
                      const isAvailable = !isFuture && !isWithdrawn;

                      return (
                        <div
                          key={cls.id}
                          className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-xs transition-colors hover:border-[var(--foreground)]/10 bg-[var(--background)] ${
                            isWithdrawn
                              ? "border-[var(--border)] opacity-60"
                              : isAvailable
                                ? "border-green-100 dark:border-green-950/50"
                                : "border-blue-100 dark:border-blue-950/50"
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="font-semibold text-[var(--foreground)]">
                              {cls.course_title}
                            </p>
                            <p className="text-[10px] text-[var(--muted)]">
                              {cls.title} • {formatDateTime(cls.starts_at)} •{" "}
                              {Number(cls.service_hours)} hrs
                              {cls.course_grade_level ? ` (grade ${cls.course_grade_level})` : ""}
                            </p>
                          </div>

                          <div>
                            {isWithdrawn ? (
                              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400">
                                Withdrawn
                              </span>
                            ) : isAvailable ? (
                              <span className="rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-950/20 dark:border-green-900/50 dark:text-green-400">
                                Available
                              </span>
                            ) : (
                              <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-400">
                                Future
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-12 text-center text-xs text-[var(--muted)]">
              Please select a tutor from the dropdown above to view classes and manage their community service hours.
            </div>
          )}
        </div>

        {/* Right Panel: ALWAYS SHOW GLOBAL WITHDRAWAL HISTORY */}
        <div className="lg:col-span-1 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Global Withdrawal History
            </h3>
            <p className="text-xs text-[var(--muted)]">
              All past hour withdrawals across all tutors.
            </p>
          </div>

          {globalWithdrawals.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 text-center text-xs text-[var(--muted)] italic">
              No past withdrawals recorded.
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {globalWithdrawals.map((w) => {
                const tutorDisplayName =
                  w.tutor_legal_name ||
                  w.tutor?.full_name ||
                  w.tutor?.email ||
                  "Unknown Tutor";

                return (
                  <div
                    key={w.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-sm space-y-2 animate-in slide-in-from-right duration-300 hover:border-[var(--foreground)]/10 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--foreground)]">
                        {w.hours} hours
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        {formatDate(w.created_at)}
                      </span>
                    </div>

                    <div className="text-[10px] text-[var(--muted)] space-y-1">
                      <p>
                        <span className="font-semibold">Tutor:</span>{" "}
                        <span className="font-medium text-[var(--foreground)]">{tutorDisplayName}</span>
                      </p>
                      <p>
                        <span className="font-semibold">Period:</span>{" "}
                        {formatDate(w.start_date)} - {formatDate(w.end_date)}
                      </p>
                    </div>

                    {w.tutor_legal_name && (
                      <div className="mt-2 border-t border-[var(--border)] pt-2 text-[9px] text-[var(--muted)] flex items-center justify-between">
                        <span>Legal Name:</span>
                        <span className="font-bold text-[var(--foreground)]">{w.tutor_legal_name}</span>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <a
                        href={`/api/withdrawals/${w.id}/certificate`}
                        download
                        className="rounded-full border border-[var(--foreground)] px-3 py-1 text-[10px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                      >
                        Download form
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
