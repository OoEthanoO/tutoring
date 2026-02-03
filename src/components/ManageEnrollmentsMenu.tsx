"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveRoleByEmail } from "@/lib/roles";

type RequestCourse = {
  id: string;
  title: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
};

type EnrollmentRequest = {
  id: string;
  status: string;
  created_at: string;
  student_name?: string | null;
  student_email?: string | null;
  course?: RequestCourse | null;
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
      const { data } = await supabase.auth.getUser();
      const role = resolveRoleByEmail(data.user?.email ?? null);
      setIsFounder(role === "founder");
    };

    load();
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
    action: "approve" | "reject"
  ) => {
    const target = requests.find((request) => request.id === requestId);
    const student = target?.student_name || target?.student_email || "student";
    const course = target?.course?.title || "this course";
    const prompt =
      action === "approve"
        ? `Approve enrollment for ${student} in ${course}?`
        : `Reject enrollment for ${student} in ${course}?`;

    if (!window.confirm(prompt)) {
      return;
    }

    setPendingId(requestId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/enrollments/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
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
      message: action === "approve" ? "Enrollment approved." : "Enrollment rejected.",
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
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
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
          return (
            <div
              key={request.id}
              className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {request.course?.title ?? "Course"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Student: {request.student_name || request.student_email || "Unknown"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Requested: {new Date(request.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => updateRequest(request.id, "approve")}
                  className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-500 transition hover:bg-emerald-600/10 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
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
