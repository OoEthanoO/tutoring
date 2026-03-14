"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";

type RequestCourse = {
  id: string;
  title: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  max_students?: number | null;
  course_enrollments?: { count: number }[];
};

type StudentApplication = {
  id: string;
  guardian_email: string;
  student_full_name: string;
  school_name: string;
  grade: string;
  parent_guardian_name: string;
  parent_guardian_phone: string;
  consent_name: string;
  created_at: string;
};

type EnrollmentRequest = {
  id: string;
  status: string;
  created_at: string;
  student_name?: string | null;
  student_email?: string | null;
  course?: RequestCourse | null;
  student_application?: StudentApplication | null;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function ManageEnrollmentsMenu() {
  const [isFounder, setIsFounder] = useState(false);
  const [requests, setRequests] = useState<EnrollmentRequest[]>([]);
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      const role = resolveUserRole(user?.email ?? null, user?.role ?? null);
      setIsFounder(role === "founder");
    };

    load();
    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isFounder) {
      return;
    }

    const fetchRequests = async () => {
      setIsLoading(true);
      setStatus({ type: "idle", message: "" });

      const response = await fetch("/api/enrollments");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to load enrollment requests.",
        });
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as {
        requests: EnrollmentRequest[];
      };
      setRequests(data.requests ?? []);
      setIsLoading(false);
    };

    fetchRequests();
  }, [isFounder]);

  const updateRequest = async (
    requestId: string,
    action: "approve" | "reject" | "expand_and_approve"
  ) => {
    const target = requests.find((request) => request.id === requestId);
    const student = target?.student_name || target?.student_email || "student";
    const course = target?.course?.title || "this course";

    let finalAction = action;

    if (action === "approve" && target?.course?.max_students) {
      const enrolled = target.course.course_enrollments?.[0]?.count ?? 0;
      if (enrolled >= target.course.max_students) {
        const confirmed = window.confirm(
          `"${course}" is currently full (${enrolled}/${target.course.max_students}).\n\nApproving this student will increase the max student count from ${target.course.max_students} to ${target.course.max_students + 1} to accommodate them.\n\nDo you want to continue?`
        );
        if (!confirmed) return;
        finalAction = "expand_and_approve";
      } else {
        if (!window.confirm(`Approve enrollment for ${student} in ${course}?`)) return;
      }
    } else if (action === "approve") {
      if (!window.confirm(`Approve enrollment for ${student} in ${course}?`)) return;
    } else {
      if (!window.confirm(`Reject enrollment for ${student} in ${course}?`)) return;
    }

    setPendingId(requestId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/enrollments/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: finalAction }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to update request.",
      });
      setPendingId(null);
      return;
    }

    setRequests((current) =>
      current.filter((request) => request.id !== requestId)
    );
    setStatus({
      type: "success",
      message: finalAction === "expand_and_approve"
        ? "Enrollment approved (max students expanded)."
        : finalAction === "approve"
          ? "Enrollment approved."
          : "Enrollment rejected.",
    });
    setPendingId(null);
  };

  if (!isFounder) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Enrollments
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Manage enrollment requests
        </h2>
      </header>

      {status.type !== "idle" ? (
        <div
          className={
            status.type === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
          }
        >
          {status.message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading requests...</p>
      ) : null}

      {!isLoading && requests.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No pending enrollment requests.
        </p>
      ) : null}

      <div className="space-y-3">
        {requests.map((request) => {
          const isPending = pendingId === request.id;
          const app = request.student_application;

          return (
            <div
              key={request.id}
              className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {request.course?.title ?? "Course"}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <p className="text-xs font-semibold text-[var(--foreground)]">
                    Student: {request.student_name || "Unknown"} ({request.student_email || "No email"})
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Tutor: {request.course?.created_by_name || request.course?.created_by_email || "Unknown"}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Requested: {new Date(request.created_at).toLocaleString()}
                  </p>
                  {request.course?.max_students ? (
                    <p className="text-xs font-medium text-[var(--muted)]">
                      Enrollment: {request.course.course_enrollments?.[0]?.count ?? 0}/{request.course.max_students}
                    </p>
                  ) : null}
                </div>
              </div>

              {app ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Student Application Form
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Student Full Name</p>
                      <p className="text-xs font-medium text-[var(--foreground)]">{app.student_full_name}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Grade & School</p>
                      <p className="text-xs font-medium text-[var(--foreground)]">{app.grade} · {app.school_name}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Parent/Guardian Name</p>
                      <p className="text-xs font-medium text-[var(--foreground)]">{app.parent_guardian_name}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Parent/Guardian Contact</p>
                      <p className="text-xs font-medium text-[var(--foreground)]">{app.guardian_email} · {app.parent_guardian_phone}</p>
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <p className="text-[10px] text-[var(--muted)]">Consent Signature</p>
                      <p className="text-xs font-medium text-[var(--foreground)] italic">{app.consent_name}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <p className="text-[10px] text-amber-700 font-medium dark:text-amber-400">
                    No application form found for this student.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => updateRequest(request.id, "approve")}
                  className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                >
                  {isPending ? "Updating..." : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => updateRequest(request.id, "reject")}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
