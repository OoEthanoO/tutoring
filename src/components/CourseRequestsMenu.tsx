"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";

type RequestRecord = {
  id: string;
  title: string;
  description: string;
  timeframes: Record<string, string>;
  frequency: string;
  total_classes: number;
  notes: string;
  status: string;
  created_at: string;
  app_users: { full_name: string; email: string };
};

const snapDateTimeLocalToFiveMinutes = (value: string) => value;
const isFiveMinuteLocal = (value: string) => true;

export default function CourseRequestsMenu() {
  const [isFounder, setIsFounder] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Approval state for a specific request
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [maxStudents, setMaxStudents] = useState<string>("");
  const [draftClassStartsAt, setDraftClassStartsAt] = useState("");
  const [draftClassDurationMinutes, setDraftClassDurationMinutes] = useState<string>("60");
  const [draftClasses, setDraftClasses] = useState<{ startsAt: string; durationHours: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setIsFounder(false);
        setIsLoading(false);
        return;
      }

      const role = resolveUserRole(user.email, user.role ?? null);
      setIsFounder(role === "founder");

      if (role === "founder") {
        fetchRequests();
      } else {
        setIsLoading(false);
      }
    };

    load();
    return onAuthChange(load);
  }, []);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/course-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      } else {
        setError("Failed to fetch requests.");
      }
    } catch (e) {
      setError("An error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Are you sure you want to reject this request?")) return;
    
    setActioningId(id);
    try {
      const res = await fetch(`/api/course-requests/${id}/reject`, { method: "POST" });
      if (res.ok) {
        setRequests(reqs => reqs.map(r => r.id === id ? { ...r, status: "rejected" } : r));
      } else {
        alert("Failed to reject request.");
      }
    } catch (e) {
      alert("An error occurred.");
    } finally {
      setActioningId(null);
    }
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingId) return;

    setActioningId(approvingId);
    try {
      const res = await fetch(`/api/course-requests/${approvingId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxStudents: maxStudents ? parseInt(maxStudents) : null,
          classes: draftClasses.map((item, index) => ({
            title: `Class ${index + 1}`,
            startsAt: new Date(item.startsAt).toISOString(),
            durationHours: item.durationHours,
          })),
        })
      });

      if (res.ok) {
        setRequests(reqs => reqs.map(r => r.id === approvingId ? { ...r, status: "approved" } : r));
        setApprovingId(null);
        setDraftClasses([]);
        setMaxStudents("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to approve request.");
      }
    } catch (err) {
      alert("An error occurred.");
    } finally {
      setActioningId(null);
    }
  };

  const addDraftClass = () => {
    if (!draftClassStartsAt) {
      alert("Class date/time is required.");
      return;
    }
    const nextEntry = {
      startsAt: draftClassStartsAt,
      durationHours: Number.parseInt(draftClassDurationMinutes) / 60 || 1,
    };
    const updatedDrafts = [...draftClasses, nextEntry];
    setDraftClasses(updatedDrafts);

    if (updatedDrafts.length > 0) {
      const latest = updatedDrafts[updatedDrafts.length - 1];
      const suggested = new Date(latest.startsAt);
      if (updatedDrafts.length === 1) {
        suggested.setDate(suggested.getDate() + 7);
      } else {
        const secondLatest = updatedDrafts[updatedDrafts.length - 2];
        const diffMs = new Date(latest.startsAt).getTime() - new Date(secondLatest.startsAt).getTime();
        suggested.setTime(suggested.getTime() + diffMs);
      }
      setDraftClassStartsAt(toLocalDateTimeInputValue(suggested));
    }
  };

  const toLocalDateTimeInputValue = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  if (!isFounder) return null;

  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--muted)]">Loading requests...</div>;
  }

  const pendingRequests = requests.filter(r => r.status === "pending");
  const historyRequests = requests.filter(r => r.status !== "pending");

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Pending Requests</h2>
        {pendingRequests.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No pending requests.</p>
        ) : (
          <div className="grid gap-4">
            {pendingRequests.map(req => (
              <div key={req.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-[var(--foreground)]">{req.title}</h3>
                    <p className="text-sm text-[var(--muted)]">Requested by {req.app_users?.full_name || req.app_users?.email}</p>
                  </div>
                  <div className="text-xs font-semibold px-2 py-1 bg-amber-100 text-amber-800 rounded-full dark:bg-amber-900/30 dark:text-amber-400">
                    Pending
                  </div>
                </div>
                
                <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap">{req.description}</p>
                
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Timeframes</p>
                    <ul className="text-sm space-y-1">
                      {Object.entries(req.timeframes || {}).filter(([_, v]) => v).map(([day, time]) => (
                        <li key={day}><span className="font-medium">{day}:</span> {time}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Frequency</p>
                    <p className="text-sm">{req.frequency}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Total Classes</p>
                    <p className="text-sm">{req.total_classes}</p>
                  </div>
                </div>

                {req.notes && (
                  <div className="space-y-1 bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Notes</p>
                    <p className="text-sm">{req.notes}</p>
                  </div>
                )}

                {approvingId === req.id ? (
                  <form onSubmit={handleApproveSubmit} className="mt-6 space-y-4 border-t border-[var(--border)] pt-4">
                    <h4 className="font-semibold text-sm text-[var(--foreground)]">Approve &amp; Create Classes</h4>
                    
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Max Students (Optional)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={maxStudents}
                        onChange={(e) => setMaxStudents(e.target.value)}
                        placeholder="Leave blank for unlimited"
                        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none"
                      />
                    </div>

                    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Classes</p>
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Date &amp; time</label>
                          <input
                            type="datetime-local"
                            value={draftClassStartsAt}
                            onChange={(e) => setDraftClassStartsAt(e.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Duration (min)</label>
                          <input
                            type="number"
                            value={draftClassDurationMinutes}
                            onChange={(e) => setDraftClassDurationMinutes(e.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={addDraftClass}
                          className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold sm:col-span-2 hover:bg-[var(--border)] transition"
                        >
                          Add class
                        </button>
                      </div>
                      
                      {draftClasses.length > 0 && (
                        <ul className="space-y-2 text-xs">
                          {draftClasses.map((c, i) => (
                            <li key={i} className="flex justify-between p-2 border border-[var(--border)] rounded">
                              <span>Class {i + 1} - {new Date(c.startsAt).toLocaleString()} ({Math.round(c.durationHours * 60)}m)</span>
                              <button
                                type="button"
                                onClick={() => setDraftClasses(prev => prev.filter((_, idx) => idx !== i))}
                                className="text-red-500 hover:underline"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={actioningId === req.id || draftClasses.length === 0}
                        className="rounded-full bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {actioningId === req.id ? "Approving..." : "Confirm Approval"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovingId(null)}
                        className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--border)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => { setApprovingId(req.id); setDraftClasses([]); }}
                      disabled={actioningId !== null}
                      className="rounded-full border border-emerald-600 text-emerald-600 px-4 py-2 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950 transition disabled:opacity-50"
                    >
                      Approve &amp; Setup Classes
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      disabled={actioningId !== null}
                      className="rounded-full border border-red-600 text-red-600 px-4 py-2 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {historyRequests.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">History</h2>
          <div className="grid gap-4">
            {historyRequests.map(req => (
              <div key={req.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 flex justify-between items-center opacity-70">
                <div>
                  <h3 className="font-semibold text-[var(--foreground)]">{req.title}</h3>
                  <p className="text-xs text-[var(--muted)]">Requested by {req.app_users?.full_name || req.app_users?.email}</p>
                </div>
                <div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    req.status === "approved" 
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  }`}>
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
