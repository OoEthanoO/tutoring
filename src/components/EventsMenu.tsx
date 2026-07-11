"use client";

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/authClient";
import { isExecutive, isFounder, resolveUserRole, type UserRole } from "@/lib/roles";

type EventResponse = {
  user_id: string;
  attendance: "yes" | "no";
  user?: {
    full_name: string;
    is_junior: boolean;
  };
};

type EventDate = {
  id: string;
  starts_at: string;
  is_time_specified: boolean;
  event_responses: EventResponse[];
};

type Event = {
  id: string;
  title: string;
  description: string;
  location: string;
  is_junior_excluded: boolean;
  deadline: string;
  event_dates: EventDate[];
  all_executives?: {
    id: string;
    full_name: string;
    email?: string;
    is_junior: boolean;
    role: string;
  }[];
};

export default function EventsMenu() {
   const [role, setRole] = useState<UserRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState("");
  
  // Create Event Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [dates, setDates] = useState<{id?: string, starts_at: string, is_time_specified: boolean}[]>([
    { starts_at: "", is_time_specified: true }
  ]);
  const [location, setLocation] = useState("");
  const [isJuniorExcluded, setIsJuniorExcluded] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  
  // Modal State
  const [modalData, setModalData] = useState<{
    label: string,
    users: { id: string, full_name: string, email?: string }[]
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (user) {
        setRole(resolveUserRole(user.email, user.role));
        setUserId(user.id);
      }
    };
    load();
  }, []);

  const fetchEvents = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to load events");
      }
    } catch {
      setError("Failed to load events");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (role && isExecutive(role)) {
      fetchEvents();
    }
  }, [role]);

  const handleAddDate = () => setDates([...dates, { starts_at: "", is_time_specified: true }]);
  const handleRemoveDate = (index: number) => setDates(dates.filter((_, i) => i !== index));
  const handleDateChange = (index: number, starts_at: string) => {
    const newDates = [...dates];
    newDates[index].starts_at = starts_at;
    setDates(newDates);
  };
  const handleTimeToggle = (index: number) => {
    const newDates = [...dates];
    newDates[index].is_time_specified = !newDates[index].is_time_specified;
    setDates(newDates);
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const validDates = dates.filter(d => !!d.starts_at);
    if (validDates.length === 0) {
      alert("Please add at least one date.");
      return;
    }

    const payloadDates = validDates.map(d => ({
      id: d.id,
      starts_at: d.is_time_specified ? new Date(d.starts_at).toISOString() : d.starts_at,
      is_time_specified: d.is_time_specified
    }));

    setIsCreating(true);
    try {
      const res = await fetch("/api/events", {
        method: editingEventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingEventId,
          title,
          description,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          dates: payloadDates,
          location,
          is_junior_excluded: isJuniorExcluded,
        }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setTitle("");
        setDescription("");
        setDeadline("");
        setDates([{ starts_at: "", is_time_specified: true }]);
        setLocation("");
        setIsJuniorExcluded(false);
        setEditingEventId(null);
        fetchEvents();
      } else {
        alert(data.error || `Failed to ${editingEventId ? "update" : "create"} event`);
      }
    } catch {
      alert("An unexpected error occurred.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRSVP = async (eventDateId: string, attendance: "yes" | "no", isDeselect: boolean = false) => {
    try {
      const method = isDeselect ? "DELETE" : "PATCH";
      const url = isDeselect ? `/api/events?event_date_id=${eventDateId}` : "/api/events";
      const body = isDeselect ? undefined : JSON.stringify({ event_date_id: eventDateId, attendance });

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        fetchEvents();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update RSVP");
      }
    } catch {
      alert("Failed to update RSVP");
    }
  };

  const copyEventLink = (eventId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("event_id", eventId);
    navigator.clipboard.writeText(url.toString());
    alert("Event link copied to clipboard!");
  };

  const startEdit = (event: Event) => {
    setEditingEventId(event.id);
    setTitle(event.title);
    setDescription(event.description);
    if (event.deadline) {
      const dateObj = new Date(event.deadline);
      const tzOffset = dateObj.getTimezoneOffset() * 60000;
      setDeadline(new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16));
    } else {
      setDeadline("");
    }
    setLocation(event.location);
    setIsJuniorExcluded(event.is_junior_excluded);
    setDates(event.event_dates.map(d => {
      let starts = d.starts_at;
      if (d.starts_at.includes('T')) {
        if (d.is_time_specified) {
          const dateObj = new Date(d.starts_at);
          const tzOffset = dateObj.getTimezoneOffset() * 60000;
          starts = new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16);
        } else {
          starts = d.starts_at.substring(0, 10);
        }
      }
      return {
        id: d.id,
        starts_at: starts,
        is_time_specified: d.is_time_specified
      };
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    if (!confirm("This action cannot be undone. Are you absolutely sure?")) return;
    try {
      const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      if (res.ok) {
        fetchEvents();
      } else {
        alert("Failed to delete event.");
      }
    } catch {
      alert("An unexpected error occurred.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--foreground)] border-t-transparent" />
      </div>
    );
  }

  const isFounderUser = role ? isFounder(role) : false;

  return (
    <div className="space-y-8">
      {isFounderUser && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <header className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {editingEventId ? "Edit Event" : "Create Event"}
              </p>
              {editingEventId && (
                <button 
                  onClick={() => {
                    setEditingEventId(null);
                    setTitle("");
                    setDescription("");
                    setDeadline("");
                    setDates([{ starts_at: "", is_time_specified: true }]);
                    setLocation("");
                    setIsJuniorExcluded(false);
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider text-red-600 hover:underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {editingEventId ? "Update your event details" : "Plan an upcoming executive event with alternate dates"}
            </h2>
          </header>
          <form onSubmit={handleCreateEvent} className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Event Title
                </label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                  placeholder="Executive Meeting"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Location
                </label>
                <input
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                  placeholder="Discord / Library Room 1"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Possible Dates
              </label>
              {dates.map((dateObj, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      required
                      type={dateObj.is_time_specified ? "datetime-local" : "date"}
                      value={dateObj.starts_at}
                      onChange={(e) => handleDateChange(idx, e.target.value)}
                      className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                    />
                    {dates.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDate(idx)}
                        className="rounded-xl border border-red-200 px-3 text-red-600 transition hover:bg-red-50"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`time-${idx}`}
                      checked={dateObj.is_time_specified}
                      onChange={() => handleTimeToggle(idx)}
                      className="h-3 w-3 rounded border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:ring-0"
                    />
                    <label htmlFor={`time-${idx}`} className="text-[11px] font-medium text-[var(--muted)]">
                      Specify Exact Time
                    </label>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddDate}
                className="flex items-center gap-2 text-xs font-bold text-[var(--foreground)] hover:opacity-70"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add another date
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                rows={3}
                placeholder="Discussing upcoming workshops..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                RSVP Deadline
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
              />
              <p className="text-[10px] text-[var(--muted)]">
                If left blank, defaults to the start of the earliest event date.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="juniorExcluded"
                checked={isJuniorExcluded}
                onChange={(e) => setIsJuniorExcluded(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:ring-0"
              />
              <label htmlFor="juniorExcluded" className="text-sm text-[var(--muted)]">
                Exclude Junior Executives
              </label>
            </div>

            <button
              disabled={isCreating}
              type="submit"
              className="mt-2 w-full rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm font-bold text-[var(--background)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {isCreating ? (editingEventId ? "Updating..." : "Creating...") : (editingEventId ? "Update Event" : "Create Event")}
            </button>
          </form>
        </section>
      )}

      <section className="space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Upcoming Events
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {events.length === 0 ? "No upcoming events scheduled" : "Scheduled events and meetings"}
          </h2>
        </header>

        <div className="grid gap-6">
          {events.map((event) => {
            const sortedDates = [...event.event_dates].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
            const earliestDate = sortedDates[0];

            return (
              <div key={event.id} id={`event-${event.id}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-all duration-500 target:ring-2 target:ring-[var(--foreground)] scroll-mt-24">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-xl font-bold text-[var(--foreground)]">{event.title}</h3>
                      <div className="flex items-center gap-3 mt-1.5 ">
                        {isFounderUser && (
                          <>
                            <button
                              onClick={() => startEdit(event)}
                              className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] transition-colors underline underline-offset-4"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteEvent(event.id)}
                              className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors underline underline-offset-4"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => copyEventLink(event.id)}
                              className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] transition-colors underline underline-offset-4"
                            >
                              Copy Link
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {event.location ? (
                        <div className="flex items-center gap-2">
                          <span>{event.location}</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(event.location);
                              alert("Location copied!");
                            }}
                            className="p-1 rounded hover:bg-[var(--border)] transition-colors opacity-70 hover:opacity-100"
                            title="Copy Location"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <span className="italic opacity-80">Not Determined Yet</span>
                      )}
                    </div>
                    {event.description && (
                      <p className="max-w-xl text-sm leading-relaxed text-[var(--muted)] whitespace-pre-wrap">
                        {event.description}
                      </p>
                    )}
                    <div className="pt-2">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        RSVP Deadline: {new Date(event.deadline).toLocaleString("en-US", {
                          weekday: "short", month: "short", day: "numeric", 
                          ...(earliestDate?.is_time_specified ? { hour: "numeric", minute: "2-digit" } : {})
                        })}
                      </p>
                    </div>
                  </div>

                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        {isFounderUser ? "Attendance Status per Date" : "Select your availability for each date"}
                      </p>
                      {event.event_dates.length > 1 && !isFounderUser && (
                        <p className="text-[10px] italic text-[var(--muted)] leading-relaxed">
                          Note: This event typically takes place on only one of these dates. Please mark your availability for all dates.
                        </p>
                      )}
                    </div>
                    
                    <div className="grid gap-4">
                      {event.event_dates.map((dateObj) => {
                        const dateStr = new Date(dateObj.starts_at).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short", day: "numeric",
                          ...(dateObj.is_time_specified ? { hour: "numeric", minute: "2-digit" } : { timeZone: "UTC" }),
                        });
                         const myResponse = dateObj.event_responses.find(r => r.user_id === userId);
                         const isPastDeadline = new Date() > new Date(event.deadline);

                         return (
                           <div key={dateObj.id} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
                             <div className="space-y-1">
                               <span className="text-sm font-semibold">{dateStr}</span>
                               {isPastDeadline && (
                                 <p className="text-[10px] font-bold uppercase text-red-500">RSVP Closed</p>
                                )}
                             </div>
                             
                             {!isFounderUser && (
                               <div className="flex gap-2">
                                 <button
                                   disabled={isPastDeadline}
                                   onClick={() => handleRSVP(dateObj.id, "yes", myResponse?.attendance === "yes")}
                                   className={`flex-1 min-w-[100px] rounded-lg px-4 py-2 text-xs font-bold transition ${
                                     myResponse?.attendance === "yes"
                                       ? "bg-green-600 text-white"
                                       : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--border)]"
                                   } ${isPastDeadline ? "opacity-50 cursor-not-allowed" : ""}`}
                                 >
                                   Going
                                 </button>
                                 <button
                                   disabled={isPastDeadline}
                                   onClick={() => handleRSVP(dateObj.id, "no", myResponse?.attendance === "no")}
                                   className={`flex-1 min-w-[100px] rounded-lg px-4 py-2 text-xs font-bold transition ${
                                     myResponse?.attendance === "no"
                                       ? "bg-red-600 text-white"
                                       : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--border)]"
                                   } ${isPastDeadline ? "opacity-50 cursor-not-allowed" : ""}`}
                                 >
                                   Not Going
                                 </button>
                               </div>
                             )}

                             {isFounderUser && event.all_executives && (
                               <div className="grid grid-cols-3 gap-6 w-full max-w-lg">
                                 {[
                                   {
                                     label: "Going",
                                     color: "text-green-600",
                                     users: event.all_executives.filter(exec => 
                                       dateObj.event_responses.some(r => r.user_id === exec.id && r.attendance === "yes")
                                     )
                                   },
                                   {
                                     label: "Not Going",
                                     color: "text-red-600",
                                     users: event.all_executives.filter(exec => 
                                       dateObj.event_responses.some(r => r.user_id === exec.id && r.attendance === "no")
                                     )
                                   },
                                   {
                                     label: "Pending",
                                     color: "text-[var(--muted)]",
                                     users: event.all_executives.filter(exec => 
                                       !dateObj.event_responses.some(r => r.user_id === exec.id)
                                     )
                                   }
                                 ].map((group) => (
                                   <button 
                                     key={group.label}
                                     onClick={() => setModalData({ label: group.label, users: group.users })}
                                     className="space-y-0.5 group/btn"
                                   >
                                     <p className={`text-[9px] font-bold uppercase group-hover/btn:underline ${group.color}`}>{group.label}</p>
                                     <p className="text-sm font-bold">{group.users.length}</p>
                                   </button>
                                 ))}
                               </div>
                             )}
                           </div>
                         );
                       })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      {/* Attendance Modal */}
      {modalData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl transition-all duration-500 scale-100">
            <div className="border-b border-[var(--border)] bg-[var(--background)] px-6 py-4 flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">
                {modalData.label} List
              </h3>
              <button 
                onClick={() => setModalData(null)}
                className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-all"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {modalData.users.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted)] opacity-50">Empty List</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {modalData.users.map((u) => (
                    <div key={u.id} className="py-3 flex flex-col justify-center group">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">{u.full_name}</span>
                      {u.email && (
                        <span className="text-[10px] text-[var(--muted)] mt-0.5 tracking-wider">{u.email}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-[var(--border)] bg-[var(--background)] p-4 flex gap-3">
              <button
                onClick={() => {
                  const text = modalData.users.map(u => `${u.full_name}, ${u.email || ''}`).join('\n');
                  navigator.clipboard.writeText(text);
                  alert('Copied attendees to clipboard!');
                }}
                disabled={modalData.users.length === 0}
                className="w-full rounded-2xl border border-[var(--border)] py-3 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--foreground)] transition hover:bg-[var(--surface)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Copy Info
              </button>
              <button
                onClick={() => setModalData(null)}
                className="w-full rounded-2xl bg-[var(--foreground)] py-3 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--background)] transition hover:opacity-90 active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
