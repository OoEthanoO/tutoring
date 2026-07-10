"use client";

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/authClient";
import { isExecutive, isFounder, resolveUserRole } from "@/lib/roles";

type FormResponse = {
  user_id: string;
  response: string;
  user?: {
    full_name: string;
    email?: string;
    is_junior: boolean;
  };
};

type Form = {
  id: string;
  title: string;
  description: string;
  options: string[];
  deadline: string;
  form_responses: FormResponse[];
  all_executives?: {
    id: string;
    full_name: string;
    email?: string;
    is_junior: boolean;
    role: string;
  }[];
};

export default function FormsMenu() {
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState("");

  // Create Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);

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

  const fetchForms = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/forms");
      if (res.ok) {
        const data = await res.json();
        setForms(data.forms || []);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to load forms");
      }
    } catch {
      setError("Failed to load forms");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (role && isExecutive(role as any)) {
      fetchForms();
    }
  }, [role]);

  const handleAddOption = () => setOptions([...options, ""]);
  const handleRemoveOption = (index: number) => setOptions(options.filter((_, i) => i !== index));
  const handleOptionChange = (index: number, val: string) => {
    const newOptions = [...options];
    newOptions[index] = val;
    setOptions(newOptions);
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = options.filter(o => o.trim() !== "");
    if (validOptions.length < 2) {
      alert("Please provide at least two valid options.");
      return;
    }

    setIsCreating(true);
    try {
      const method = editingFormId ? "PUT" : "POST";
      const url = editingFormId ? `/api/forms/${editingFormId}` : "/api/forms";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          options: validOptions,
          deadline: new Date(deadline).toISOString()
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setTitle("");
        setDescription("");
        setDeadline("");
        setOptions(["", ""]);
        setEditingFormId(null);
        fetchForms();
      } else {
        alert(data.error || `Failed to ${editingFormId ? "update" : "create"} form`);
      }
    } catch {
      alert("An unexpected error occurred.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRespond = async (formId: string, response: string, isDeselect: boolean = false) => {
    try {
      const method = isDeselect ? "DELETE" : "POST";
      const body = isDeselect ? undefined : JSON.stringify({ response });
      const res = await fetch(`/api/forms/${formId}/respond`, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        fetchForms();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to submit response");
      }
    } catch {
      alert("Failed to submit response");
    }
  };

  const copyFormLink = (formId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("form_id", formId);
    navigator.clipboard.writeText(url.toString());
    alert("Form link copied to clipboard!");
  };

  const startEdit = (form: Form) => {
    setEditingFormId(form.id);
    setTitle(form.title);
    setDescription(form.description);
    setOptions(form.options);
    
    if (form.deadline) {
      const dateObj = new Date(form.deadline);
      const tzOffset = dateObj.getTimezoneOffset() * 60000;
      setDeadline(new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16));
    } else {
      setDeadline("");
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteForm = async (formId: string) => {
    if (!confirm("Are you sure you want to delete this form?")) return;
    try {
      const res = await fetch(`/api/forms/${formId}`, { method: "DELETE" });
      if (res.ok) {
        fetchForms();
      } else {
        alert("Failed to delete form.");
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

  const isFounderUser = role ? isFounder(role as any) : false;

  return (
    <div className="space-y-8">
      {isFounderUser && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <header className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {editingFormId ? "Edit Form" : "Create Form"}
              </p>
              {editingFormId && (
                <button
                  onClick={() => {
                    setEditingFormId(null);
                    setTitle("");
                    setDescription("");
                    setDeadline("");
                    setOptions(["", ""]);
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider text-red-600 hover:underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {editingFormId ? "Update your form details" : "Create a multiple-choice question for executives"}
            </h2>
          </header>
          <form onSubmit={handleCreateForm} className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Form Question/Title
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                placeholder="What should we do for the next workshop?"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                rows={2}
                placeholder="Optional details..."
              />
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Multiple Choice Options
              </label>
              {options.map((opt, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    required
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                    placeholder={`Option ${idx + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      className="rounded-xl border border-red-200 px-3 text-red-600 transition hover:bg-red-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={handleAddOption}
                className="flex items-center gap-2 text-xs font-bold text-[var(--foreground)] hover:opacity-70"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add another option
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Deadline
              </label>
              <input
                required
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
              />
              <p className="text-[10px] text-[var(--muted)]">
                Responses cannot be changed after this deadline.
              </p>
            </div>

            <button
              disabled={isCreating}
              type="submit"
              className="mt-2 w-full rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm font-bold text-[var(--background)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {isCreating ? (editingFormId ? "Updating..." : "Creating...") : (editingFormId ? "Update Form" : "Create Form")}
            </button>
          </form>
        </section>
      )}

      <section className="space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Active Forms
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {forms.length === 0 ? "No active forms" : "Multiple choice questions"}
          </h2>
        </header>

        <div className="grid gap-6">
          {forms.map((form) => {
            const isPastDeadline = new Date() > new Date(form.deadline);
            const userResponse = form.form_responses.find(r => r.user_id === userId);

            return (
              <div
                key={form.id}
                id={`form-${form.id}`}
                className={`group flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 transition-all hover:shadow-md ${isPastDeadline ? 'opacity-80' : ''}`}
              >
                <div className="mb-4 flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                      {form.title}
                    </h3>
                    {form.description && (
                      <p className="text-sm font-medium text-[var(--muted)]">
                        {form.description}
                      </p>
                    )}
                    <div className="pt-2">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        Deadline: {new Date(form.deadline).toLocaleString("en-US", {
                          weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
                        })}
                        {isPastDeadline && <span className="text-red-500">(Closed)</span>}
                      </p>
                    </div>
                  </div>
                  {isFounderUser && (
                    <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => copyFormLink(form.id)}
                        className="rounded-full bg-[var(--background)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]"
                        title="Copy link"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </button>
                      <button
                        onClick={() => startEdit(form)}
                        className="rounded-full bg-[var(--background)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]"
                        title="Edit form"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteForm(form.id)}
                        className="rounded-full bg-[var(--background)] p-2 text-red-400 hover:text-red-600"
                        title="Delete form"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {form.options.map((opt, i) => {
                    const isSelected = userResponse?.response === opt;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <button
                          disabled={isPastDeadline || isFounderUser}
                          onClick={() => handleRespond(form.id, opt, isSelected)}
                          className={`flex-1 rounded-xl border p-3 text-left transition-all ${
                            isSelected 
                              ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)] font-bold"
                              : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--foreground)]"
                          } ${(isPastDeadline || isFounderUser) ? "cursor-not-allowed opacity-80 hover:border-[var(--border)]" : ""}`}
                        >
                          {opt}
                        </button>
                        {isFounderUser && (
                          <div className="w-20 text-right">
                            <button
                              onClick={() => {
                                const respondents = form.form_responses
                                  .filter(r => r.response === opt)
                                  .map(r => ({
                                    id: r.user_id,
                                    full_name: r.user?.full_name || "Unknown",
                                    email: r.user?.email
                                  }));
                                setModalData({ label: `Responded "${opt}"`, users: respondents });
                              }}
                              className="text-xs font-bold text-[var(--muted)] hover:text-[var(--foreground)] underline decoration-dotted underline-offset-4"
                            >
                              {form.form_responses.filter(r => r.response === opt).length} responses
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isFounderUser && form.all_executives && (
                  <div className="mt-6 border-t border-[var(--border)] pt-4">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                      <span>Response Rate</span>
                      <span>
                        {form.form_responses.length} / {form.all_executives.length} Execs
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => {
                          const nonResponders = form.all_executives!.filter(
                            e => !form.form_responses.some(r => r.user_id === e.id)
                          ).map(u => ({ id: u.id, full_name: u.full_name, email: u.email }));
                          setModalData({ label: "Missing Responses", users: nonResponders });
                        }}
                        className="rounded-full bg-[var(--background)] px-3 py-1.5 text-[9px] font-bold text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)] transition-colors"
                      >
                        View Missing ({form.all_executives.length - form.form_responses.length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal */}
      {modalData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm transition-all duration-300">
          <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl transition-all duration-500 scale-100">
            <div className="border-b border-[var(--border)] bg-[var(--background)] px-6 py-4 flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">
                {modalData.label}
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
