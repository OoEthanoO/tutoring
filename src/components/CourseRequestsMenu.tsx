"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { isFounder, resolveUserRole } from "@/lib/roles";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import CourseCreator from "./CourseCreator";

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
  created_by: string;
  created_at: string;
  is_co_taught?: boolean;
  co_tutor_id?: string;
  app_users: { full_name: string; email: string };
  co_tutor?: { full_name: string; email: string };
};

const snapDateTimeLocalToFiveMinutes = (value: string) => value;
const isFiveMinuteLocal = (value: string) => true;

const dayOrder: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export default function CourseRequestsMenu() {
  const [role, setRole] = useState<string | null>(null);
  const [isFounderAccess, setIsFounderAccess] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isCreatorModalOpen, setIsCreatorModalOpen] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  
  // Approval state for a specific request
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [maxStudents, setMaxStudents] = useState<string>("");
  const [donationFee, setDonationFee] = useState<string>("");
  const [draftClassStartsAt, setDraftClassStartsAt] = useState<Date | null>(new Date());
  const [draftClassDurationMinutes, setDraftClassDurationMinutes] = useState<string>("60");
  const [draftClassTutorId, setDraftClassTutorId] = useState<string>("");
  const [draftClasses, setDraftClasses] = useState<{ startsAt: string; durationHours: number; tutorId?: string }[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setIsFounderAccess(false);
        setIsLoading(false);
        return;
      }

      const resolvedRole = resolveUserRole(user.email, user.role ?? null);
      setRole(resolvedRole);
      setIsFounderAccess(isFounder(resolvedRole as any));

      fetchRequests();
    };

    load();
    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (isCreatorModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => { document.body.style.overflow = "unset"; };
  }, [isCreatorModalOpen]);

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

  const handleReject = (id: string) => {
    // Open the rejection note UI
    setRejectingId(id);
    setRejectNote("");
  };

  const submitRejection = async (id: string) => {
    if (!rejectNote || !rejectNote.trim()) {
      alert("Please provide a reason for rejection.");
      return;
    }

    setActioningId(id);
    try {
      const res = await fetch(`/api/course-requests/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: rejectNote.trim() }),
      });
      if (res.ok) {
        setRequests(reqs => reqs.map(r => r.id === id ? { ...r, status: "rejected", notes: rejectNote.trim() } : r));
        setRejectingId(null);
        setRejectNote("");
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || "Failed to reject request.");
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
          status: "in_review",
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
          donationFee: donationFee ? parseInt(donationFee) : null,
          classes: draftClasses.map((item, index) => ({
            title: `Class ${index + 1}`,
            startsAt: new Date(item.startsAt).toISOString(),
            durationHours: item.durationHours,
            tutorId: item.tutorId,
          })),
        })
      });

      if (res.ok) {
        setRequests(reqs => reqs.map(r => r.id === approvingId ? { ...r, status: "approved" } : r));
        setApprovingId(null);
        setDraftClasses([]);
        setMaxStudents("");
        setDonationFee("");
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

  const changeStatus = async (requestId: string, newStatus: string) => {
    setActioningId(requestId);
    try {
      const res = await fetch("/api/course-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status: newStatus }),
      });
      if (res.ok) {
        setRequests(reqs => reqs.map(r => r.id === requestId ? { ...r, status: newStatus } : r));
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Failed to change status: ${errorData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      alert(`An error occurred: ${e.message}`);
    } finally {
      setActioningId(null);
    }
  };

  const addDraftClass = (tutorId?: string) => {
    if (!draftClassStartsAt) {
      alert("Class date/time is required.");
      return;
    }
    const nextEntry = {
      startsAt: draftClassStartsAt ? draftClassStartsAt.toISOString() : new Date().toISOString(),
      durationHours: Number.parseInt(draftClassDurationMinutes) / 60 || 1,
      tutorId: tutorId || undefined,
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

  if (!role) return null;

  const getStatusBadge = (status: string) => {
    const badgeClasses: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
      in_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    const label = status === "in_review" || status === "pending" ? "In Review" : status.charAt(0).toUpperCase() + status.slice(1);
    const classes = badgeClasses[status] ?? badgeClasses['in_review'] ?? badgeClasses.draft;
    return { label, classes };
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--muted)]">Loading requests...</div>;
  }

  const inReviewRequests = requests.filter(r => r.status === "in_review" || r.status === "pending");
  const otherRequests = requests.filter(r => !(r.status === "in_review" || r.status === "pending"));

  // Unified page: founders see pending (in_review) + history; non-founders see their own history (GET already filters)
  const displayRequests = isFounderAccess
    ? { pending: inReviewRequests, history: otherRequests }
    : { pending: [], history: requests };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">Course Requests</h1>
          {isFounderAccess ? (
            <p className="text-sm text-[var(--muted)]">Manage and review incoming course creation requests.</p>
          ) : (
            <p className="text-sm text-[var(--muted)]">Submit and track your course creation requests.</p>
          )}
        </div>
        <button
          onClick={() => {
            setEditData(null);
            setIsCreatorModalOpen(true);
          }}
          className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--background)] transition-colors hover:bg-[var(--foreground)]/90"
        >
          Submit course request
        </button>
      </div>

      {isCreatorModalOpen && (
        <div className="fixed top-0 left-0 z-50 flex h-[100dvh] w-[100dvw] items-center justify-center p-4 bg-black/50 backdrop-blur-sm shadow-xl">
          <div className="relative w-full max-w-2xl bg-[var(--background)] rounded-2xl border border-[var(--border)] overflow-hidden my-auto max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
              <h2 className="text-lg font-bold">{editData ? "Edit course request" : "Submit course request"}</h2>
              <button 
                onClick={() => { 
                  setIsCreatorModalOpen(false); 
                  setEditData(null);
                  fetchRequests(); 
                }} 
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <CourseCreator 
                editData={editData} 
                onSuccess={() => {
                  fetchRequests();
                  setIsCreatorModalOpen(false);
                  setEditData(null);
                }}
                onCancel={() => {
                  setIsCreatorModalOpen(false);
                  setEditData(null);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {isFounderAccess && displayRequests.pending.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Pending Review</h2>
          <div className="grid gap-4">
            {displayRequests.pending.map(req => (
              <div key={req.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-[var(--foreground)]">
                      {req.title}
                      {req.is_co_taught && (
                        <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          Co-taught
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-[var(--muted)]">
                      Primary Tutor: {req.app_users?.full_name || req.app_users?.email}
                    </p>
                    {req.is_co_taught && req.co_tutor && (
                      <p className="text-sm text-[var(--muted)]">
                        Secondary Tutor: {req.co_tutor?.full_name || req.co_tutor?.email}
                      </p>
                    )}
                  </div>
                  {isFounderAccess ? (
                    <select 
                      value={req.status}
                      onChange={(e) => changeStatus(req.id, e.target.value)}
                      disabled={actioningId === req.id}
                      style={{ textAlignLast: "center" }} className={`text-xs font-semibold px-3 py-1 outline-none appearance-none rounded-full cursor-pointer hover:opacity-80 transition disabled:opacity-50 text-center ${getStatusBadge(req.status).classes}`}
                    >
                      <option value="draft">Draft</option>
                      <option value="in_review">In Review</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  ) : (
                    <div className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusBadge(req.status).classes}`}>
                      {getStatusBadge(req.status).label}
                    </div>
                  )}
                </div>
                
                <p className="text-sm text-[var(--foreground)]">{req.description || "(No description)"}</p>
                
                <div className="flex flex-wrap gap-x-12 gap-y-4 pt-2">
                  {req.frequency && (
                    <div>
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Frequency</p>
                      <p className="text-sm font-medium mt-0.5">{req.frequency}</p>
                    </div>
                  )}
                  {req.total_classes && (
                    <div>
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Classes</p>
                      <p className="text-sm font-medium mt-0.5">{req.total_classes}</p>
                    </div>
                  )}
                  {req.start_date && (
                    <div>
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Start Date</p>
                      <p className="text-sm font-medium mt-0.5">{req.start_date}</p>
                    </div>
                  )}
                </div>
                
                {Object.keys(req.timeframes || {}).filter(([_, v]) => v).length > 0 && (
                  <div className="pt-2">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)] mb-2">Timeframes</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(req.timeframes || {})
                        .filter(([_, v]) => v)
                        .sort(([dayA], [dayB]) => (dayOrder[dayA] ?? 7) - (dayOrder[dayB] ?? 7))
                        .map(([day, time]) => (
                        <div key={day} className="px-3 py-1.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--foreground)]">
                          <span className="font-semibold">{day}:</span> {time}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {req.notes && (
                  <div className="pt-2">
                     <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)] mb-1.5">Notes</p>
                     <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 p-4 text-sm text-orange-900 dark:text-orange-200 whitespace-pre-wrap">
                       {req.notes}
                     </div>
                  </div>
                )}

                {approvingId === req.id ? (
                  <form onSubmit={handleApproveSubmit} className="mt-6 space-y-4 border-t border-[var(--border)] pt-4">
                    <h4 className="font-semibold text-sm">Approve &amp; Create Classes</h4>
                    <div>
                      <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Max Students</label>
                      <input type="number" min="1" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="Leave blank for unlimited" className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" />
                    </div>

                    <div>
                      <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Donation Fee</label>
                      <input type="number" min="0" value={donationFee} onChange={(e) => setDonationFee(e.target.value)} placeholder="0 or leave blank for none" className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" />
                    </div>

                    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Classes</p>
                      <div className={`grid gap-3 ${req.is_co_taught ? 'sm:grid-cols-[1fr_auto_auto]' : 'sm:grid-cols-[1fr_auto]'}`}>
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Date &amp; time</label>
                          <div className="mt-1">
                            <DatePicker
                              selected={draftClassStartsAt}
                              onChange={(date: Date | null) => setDraftClassStartsAt(date)}
                              showTimeSelect
                              dateFormat="Pp"
                              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                            />
                          </div>
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
                        {req.is_co_taught && (
                          <div className="space-y-1">
                            <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Tutor</label>
                            <select
                              value={draftClassTutorId || req.created_by}
                              onChange={(e) => setDraftClassTutorId(e.target.value)}
                              className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm"
                            >
                              <option value={req.created_by}>{req.app_users?.full_name || 'Primary'}</option>
                              <option value={req.co_tutor_id}>{req.co_tutor?.full_name || 'Secondary'}</option>
                            </select>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => addDraftClass(req.is_co_taught ? (draftClassTutorId || req.created_by) : undefined)}
                          className={`rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold hover:bg-[var(--border)] transition ${req.is_co_taught ? 'sm:col-span-3' : 'sm:col-span-2'}`}
                        >
                          Add class
                        </button>
                      </div>
                      
                      {draftClasses.length > 0 && (
                        <ul className="space-y-2 text-xs">
                          {draftClasses.map((c, i) => (
                            <li key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 border border-[var(--border)] rounded gap-2">
                              <span>Class {i + 1} - {new Date(c.startsAt).toLocaleString()} ({Math.round(c.durationHours * 60)}m)</span>
                              <div className="flex items-center gap-2">
                                {req.is_co_taught && (
                                  <select
                                    value={c.tutorId || req.created_by}
                                    onChange={(e) => {
                                      const newDrafts = [...draftClasses];
                                      newDrafts[i].tutorId = e.target.value;
                                      setDraftClasses(newDrafts);
                                    }}
                                    className="rounded border border-[var(--border)] px-2 py-1 text-xs bg-[var(--surface)] text-[var(--foreground)]"
                                  >
                                    <option value={req.created_by}>{req.app_users?.full_name || 'Primary'}</option>
                                    <option value={req.co_tutor_id}>{req.co_tutor?.full_name || 'Secondary'}</option>
                                  </select>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setDraftClasses(prev => prev.filter((_, idx) => idx !== i))}
                                  className="text-red-500 hover:underline"
                                >
                                  Remove
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 items-stretch">
                      <button
                        id={`confirm-approval-${req.id}`}
                        type="submit"
                        disabled={actioningId === req.id}
                        className="flex-1 rounded-full border border-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:opacity-50"
                        title="Confirm Approval and create course"
                      >
                        {actioningId === req.id ? "Approving..." : "Confirm Approval"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovingId(null)}
                        className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--border)] sm:ml-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  isFounderAccess && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <button onClick={() => { setApprovingId(req.id); setMaxStudents(""); setDonationFee(""); setDraftClasses([]); }} disabled={actioningId === req.id} className="flex-1 rounded-full border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-70">
                          Approve
                        </button>
                        <button onClick={() => handleReject(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-70">
                          Reject
                        </button>
                      </div>

                      {rejectingId === req.id && (
                        <div className="mt-2 space-y-2">
                          <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Rejection note (required)</label>
                          <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none" rows={3} />
                          <div className="flex gap-2">
                            <button onClick={() => submitRejection(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-70">
                              {actioningId === req.id ? "Rejecting..." : "Submit Rejection"}
                            </button>
                            <button onClick={() => { setRejectingId(null); setRejectNote(""); }} disabled={actioningId === req.id} className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm transition">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
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
                    <h3 className="font-semibold text-[var(--foreground)]">
                      {req.title}
                      {req.is_co_taught && (
                        <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          Co-taught
                        </span>
                      )}
                    </h3>
                    {isFounderAccess && (
                      <>
                        <p className="text-sm text-[var(--muted)]">Primary Tutor: {req.app_users?.full_name || req.app_users?.email}</p>
                        {req.is_co_taught && req.co_tutor && (
                          <p className="text-sm text-[var(--muted)]">Secondary Tutor: {req.co_tutor?.full_name || req.co_tutor?.email}</p>
                        )}
                      </>
                    )}
                  </div>
                  {isFounderAccess ? (
                    <select 
                      value={req.status}
                      onChange={(e) => changeStatus(req.id, e.target.value)}
                      disabled={actioningId === req.id}
                      style={{ textAlignLast: "center" }} className={`text-xs font-semibold px-3 py-1 outline-none appearance-none rounded-full cursor-pointer hover:opacity-80 transition disabled:opacity-50 text-center ${getStatusBadge(req.status).classes}`}
                    >
                      <option value="draft">Draft</option>
                      <option value="in_review">In Review</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  ) : (
                    <div className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusBadge(req.status).classes}`}>
                      {getStatusBadge(req.status).label}
                    </div>
                  )}
                </div>

                <p className="text-sm text-[var(--foreground)]">{req.description || "(No description)"}</p>
                
                <div className="flex flex-wrap gap-x-12 gap-y-4 pt-2">
                      {req.frequency && (
                        <div>
                          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Frequency</p>
                          <p className="text-sm font-medium mt-0.5">{req.frequency}</p>
                        </div>
                      )}
                      {req.total_classes && (
                        <div>
                          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Classes</p>
                          <p className="text-sm font-medium mt-0.5">{req.total_classes}</p>
                        </div>
                      )}
                      {req.start_date && (
                        <div>
                          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Start Date</p>
                          <p className="text-sm font-medium mt-0.5">{req.start_date}</p>
                        </div>
                      )}
                    </div>
                    
                    {Object.keys(req.timeframes || {}).filter(([_, v]) => v).length > 0 && (
                      <div className="pt-2">
                        <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)] mb-2">Timeframes</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(req.timeframes || {})
                            .filter(([_, v]) => v)
                            .sort(([dayA], [dayB]) => (dayOrder[dayA] ?? 7) - (dayOrder[dayB] ?? 7))
                            .map(([day, time]) => (
                            <div key={day} className="px-3 py-1.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--foreground)]">
                              <span className="font-semibold">{day}:</span> {time}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {req.notes && (
                      <div className="pt-2">
                         <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)] mb-1.5">Notes / Rejection Reason</p>
                         <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 p-4 text-sm text-orange-900 dark:text-orange-200 whitespace-pre-wrap">
                           {req.notes}
                         </div>
                      </div>
                    )}

                    {(req.status === "rejected" || req.status === "draft") && (
                      <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--border)]">
                        <button 
                          onClick={() => {
                            setEditData(req);
                            setIsCreatorModalOpen(true);
                          }} 
                          disabled={actioningId === req.id} 
                          className="flex-1 rounded-full border border-[var(--foreground)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--border)] disabled:opacity-70"
                        >
                          Edit Request
                        </button>
                        {req.status === "draft" && (
                          <button onClick={() => resubmitRequest(req.id)} disabled={actioningId === req.id} className="flex-1 rounded-full bg-[var(--foreground)] text-[var(--background)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--foreground)]/90 disabled:opacity-70">
                            {actioningId === req.id ? "Resubmitting..." : "Resubmit"}
                          </button>
                        )}
                      </div>
                    )}
              </div>
            ))}
          </div>
        </section>
      )}

      {requests.length === 0 && (
        <div className="text-center text-sm text-[var(--muted)] py-8">
          {isFounderAccess ? "No requests to review." : "No course requests yet."}
        </div>
      )}
    </div>
  );
}
