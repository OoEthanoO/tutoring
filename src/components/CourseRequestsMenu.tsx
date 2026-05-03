"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

type RequestRecord = {
  id: string;
  title: string;
  description: string;
  timeframes: Record<string, string>;
  frequency: string;
  total_classes: number;
  start_date: string;
  notes: string;
  status: string;
  created_at: string;
  app_users: { full_name: string; email: string };
};

const snapDateTimeLocalToFiveMinutes = (value: string) => value;
const isFiveMinuteLocal = (value: string) => true;

export default function CourseRequestsMenu() {
  const [role, setRole] = useState<string | null>(null);
  const [isFounder, setIsFounder] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RequestRecord>>({});

  // Approval state for a specific request
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [maxStudents, setMaxStudents] = useState<string>("");
  const [draftClassStartsAt, setDraftClassStartsAt] = useState<Date | null>(new Date());
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

      const resolvedRole = resolveUserRole(user.email, user.role ?? null);
      setRole(resolvedRole);
      setIsFounder(resolvedRole === "founder");

      fetchRequests();
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

  const startEditing = (request: RequestRecord) => {
    setEditingId(request.id);
    setEditForm({ ...request });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (requestId: string) => {
    setActioningId(requestId);
    try {
      const res = await fetch("/api/course-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: editForm.title,
          description: editForm.description,
          timeframes: editForm.timeframes,
          frequency: editForm.frequency,
          totalClasses: editForm.total_classes,
          startDate: editForm.start_date,
          notes: editForm.notes,
        }),
      });

      if (res.ok) {
        // Update local state to reflect the edit (status will change from "rejected" to "draft")
        setRequests(reqs =>
          reqs.map(r =>
            r.id === requestId
              ? { ...r, ...editForm, status: "draft" }
              : r
          )
        );
        cancelEditing();
        alert("Request updated. Submit it again to send for review.");
      } else {
        alert("Failed to save changes.");
      }
    } catch (e) {
      alert("An error occurred.");
    } finally {
      setActioningId(null);
    }
  };

  const resubmitRequest = async (requestId: string) => {
    setActioningId(requestId);
    try {
      const res = await fetch("/api/course-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: (requests.find(r => r.id === requestId)?.title || "").trim(),
        }),
      });

      if (res.ok) {
        // Change status from "draft" to "in_review"
        setRequests(reqs =>
          reqs.map(r =>
            r.id === requestId ? { ...r, status: "in_review" } : r
          )
        );
        alert("Request resubmitted for review.");
      } else {
        alert("Failed to resubmit request.");
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
      startsAt: draftClassStartsAt ? draftClassStartsAt.toISOString() : new Date().toISOString(),
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
      setDraftClassStartsAt(suggested);
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

  if (!isFounder && !role) return null;

  const getStatusBadge = (status: string) => {
    const badgeClasses: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
      in_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    const label = status === "in_review" ? "In Review" : status.charAt(0).toUpperCase() + status.slice(1);
    return { label, classes: badgeClasses[status] || badgeClasses.draft };
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--muted)]">Loading requests...</div>;
  }

  const inReviewRequests = requests.filter(r => r.status === "in_review");
  const otherRequests = requests.filter(r => r.status !== "in_review");

  // For non-founders, show their own requests; for founders, show all pending requests first
  const displayRequests = isFounder
    ? { pending: inReviewRequests, history: otherRequests }
    : { pending: [], history: otherRequests };

  return (
    <div className="space-y-8">
      {isFounder && displayRequests.pending.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Pending Review</h2>
          <div className="grid gap-4">
            {displayRequests.pending.map(req => (
              <div key={req.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-[var(--foreground)]">{req.title}</h3>
                    <p className="text-sm text-[var(--muted)]">From {req.app_users?.full_name || req.app_users?.email}</p>
                  </div>
                  <div className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusBadge(req.status).classes}`}>
                    {getStatusBadge(req.status).label}
                  </div>
                </div>
                
                <p className="text-sm text-[var(--foreground)]">{req.description || "(No description)"}</p>
                
                <div className="grid sm:grid-cols-2 gap-4">
                  {Object.keys(req.timeframes || {}).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Timeframes</p>
                      <ul className="text-sm space-y-1">
                        {Object.entries(req.timeframes || {}).filter(([_, v]) => v).map(([day, time]) => (
                          <li key={day}><span className="font-medium">{day}:</span> {time}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {req.frequency && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Frequency</p>
                      <p className="text-sm">{req.frequency}</p>
                    </div>
                  )}
                  {req.total_classes && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Total Classes</p>
                      <p className="text-sm">{req.total_classes}</p>
                    </div>
                  )}
                  {req.start_date && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Start Date</p>
                      <p className="text-sm">{req.start_date}</p>
                    </div>
                  )}
                </div>

                {req.notes && (
                  <div className="text-sm bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
                    <strong>Notes:</strong> {req.notes}
                  </div>
                )}

                {approvingId === req.id ? (
                  <form onSubmit={handleApproveSubmit} className="mt-6 space-y-4 border-t border-[var(--border)] pt-4">
                    <h4 className="font-semibold text-sm">Approve &amp; Create Classes</h4>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Max Students</label>
                      <input type="number" min="1" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="Leave blank for unlimited" className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={actioningId === req.id} className="flex-1 rounded-full border border-[var(--foreground)] px-4 py-2 text-sm font-semibold transition disabled:opacity-70">
                        {actioningId === req.id ? "Creating..." : "Create Course"}
                      </button>
                      <button type="button" onClick={() => setApprovingId(null)} className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm transition">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setApprovingId(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full bg-green-600 text-white px-4 py-2 text-sm font-semibold transition hover:bg-green-700 disabled:opacity-70">
                      Approve
                    </button>
                    <button onClick={() => handleReject(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full bg-red-600 text-white px-4 py-2 text-sm font-semibold transition hover:bg-red-700 disabled:opacity-70">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {displayRequests.history.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Request History</h2>
          <div className="grid gap-4">
            {displayRequests.history.map(req => (
              <div key={req.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-[var(--foreground)]">{req.title}</h3>
                    {!isFounder && <p className="text-sm text-[var(--muted)]">Status: {getStatusBadge(req.status).label}</p>}
                  </div>
                  <div className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusBadge(req.status).classes}`}>
                    {getStatusBadge(req.status).label}
                  </div>
                </div>

                {editingId === req.id && !isFounder ? (
                  <div className="space-y-4 border-t border-[var(--border)] pt-4">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Title</label>
                      <input type="text" value={editForm.title || ""} onChange={(e) => setEditForm({...editForm, title: e.target.value})} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Description</label>
                      <textarea value={editForm.description || ""} onChange={(e) => setEditForm({...editForm, description: e.target.value})} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" rows={3} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Frequency</label>
                      <input type="text" value={editForm.frequency || ""} onChange={(e) => setEditForm({...editForm, frequency: e.target.value})} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" placeholder="e.g., Weekly, Twice per week" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-semibold transition hover:bg-blue-700 disabled:opacity-70">
                        {actioningId === req.id ? "Saving..." : "Save Changes"}
                      </button>
                      <button onClick={cancelEditing} disabled={actioningId === req.id} className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm transition disabled:opacity-70">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-[var(--foreground)]">{req.description || "(No description)"}</p>
                    {(req.status === "rejected" || req.status === "draft") && !isFounder && (
                      <div className="flex gap-2">
                        <button onClick={() => startEditing(req)} disabled={actioningId === req.id} className="flex-1 rounded-full border border-[var(--foreground)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--border)] disabled:opacity-70">
                          Edit Request
                        </button>
                        {req.status === "draft" && (
                          <button onClick={() => resubmitRequest(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-semibold transition hover:bg-blue-700 disabled:opacity-70">
                            {actioningId === req.id ? "Resubmitting..." : "Resubmit"}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {requests.length === 0 && (
        <div className="text-center text-sm text-[var(--muted)] py-8">
          {isFounder ? "No requests to review." : "No course requests yet."}
        </div>
      )}
    </div>
  );
}
