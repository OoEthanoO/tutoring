"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { setHasUnsavedData } from "@/lib/unsavedData";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type CourseCreatorProps = {
  editData?: any | null;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export default function CourseCreator({ editData, onSuccess, onCancel }: CourseCreatorProps = {}) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [title, setTitle] = useState(editData?.title || "");
  const [description, setDescription] = useState(editData?.description || "");
  const [timeframes, setTimeframes] = useState<Record<string, string>>(editData?.timeframes || {});
  const [frequency, setFrequency] = useState(editData?.frequency || "");
  const [totalClasses, setTotalClasses] = useState<number>(editData?.total_classes || 1);
  
  // Parse editData.start_date safely, handling YYYY-MM-DD strings matching local TZ dates better
  const initialStartDate = editData?.start_date ? new Date(editData.start_date + 'T12:00:00Z') : new Date();
  const [startDate, setStartDate] = useState<Date | null>(initialStartDate);
  const [notes, setNotes] = useState(editData?.notes || "");
  const [isCoTaught, setIsCoTaught] = useState<boolean>(editData?.is_co_taught || false);
  const [coTutorId, setCoTutorId] = useState<string>(editData?.co_tutor_id || "");
  const [availableTutors, setAvailableTutors] = useState<{ id: string; name: string }[]>([]);

  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setCanCreate(false);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setCanCreate(canManageCourses(resolvedRole));

      try {
        const res = await fetch("/api/tutors");
        if (res.ok) {
          const data = await res.json();
          setAvailableTutors(data.tutors || []);
        }
      } catch (err) {
        console.error("Failed to fetch tutors", err);
      }
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (status.type === "success") {
      const timer = setTimeout(() => {
        setStatus({ type: "idle", message: "" });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Prevent accidental reloads and tab closures while the modal is open/component is mounted
  useEffect(() => {
    setHasUnsavedData("courseCreator", true);
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      setHasUnsavedData("courseCreator", false);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const handleTimeframeChange = (day: string, value: string) => {
    setTimeframes(prev => ({ ...prev, [day]: value }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    if (!title.trim()) {
      setStatus({ type: "error", message: "Please add a title." });
      return;
    }

    setShowConfirmModal(true);
  };

  const proceedWithSubmission = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);

    try {
      const isEditing = !!editData?.id;
      const response = await fetch("/api/course-requests", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: editData?.id,
          title: title.trim(),
          description: description.trim(),
          timeframes,
          frequency: frequency.trim(),
          totalClasses,
          startDate: startDate?.toISOString().split('T')[0],
          notes: notes.trim(),
          isCoTaught,
          coTutorId: isCoTaught ? coTutorId : null,
          status: isEditing && editData?.status === "rejected" ? "draft" : undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to submit course request.",
        });
        setIsSubmitting(false);
        return;
      }

      await response.json().catch(() => null);
      
      if (!isEditing) {
        setTitle("");
        setDescription("");
        setTimeframes({});
        setFrequency("");
        setTotalClasses(1);
        setStartDate(new Date());
        setNotes("");
        setIsCoTaught(false);
        setCoTutorId("");
      }
      
      setStatus({ type: "success", message: isEditing ? "Course request updated successfully." : "Course request submitted successfully." });
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setStatus({ type: "error", message: "An unexpected error occurred." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canCreate) {
    return null;
  }

  return (
    <section className="relative">
      <div className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <header className="space-y-1">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            {editData ? "Edit Request" : "Submit Request"}
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {editData ? "Edit your course creation request" : "Submit a course creation request"}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {editData ? "Your changes will be saved as a draft or sent back for review." : "Your request will be reviewed by founders before being added to the catalog."}
          </p>
        </header>

        {status.type !== "idle" ? (
          <div className="fixed inset-x-4 top-4 z-[100] flex justify-center pointer-events-none">
            <div
              className={`
                pointer-events-auto flex items-center gap-3 rounded-2xl border px-6 py-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300
                ${
                  status.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/80 dark:text-red-400"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/80 dark:text-emerald-400"
                }
              `}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                status.type === "error" ? "bg-red-100 dark:bg-red-900/50" : "bg-emerald-100 dark:bg-emerald-900/50"
              }`}>
                {status.type === "error" ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{status.type === "error" ? "Error" : "Success"}</p>
                <p className="text-sm opacity-90">{status.message}</p>
              </div>
              <button
                onClick={() => setStatus({ type: "idle", message: "" })}
                className="ml-4 rounded-lg p-1 hover:bg-black/5 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Title
            </label>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Intro to Python"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              required
            />
          </div>

          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Description
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What students will learn, projects, and outcomes."
              rows={4}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">Markdown is supported for formatting</p>
          </div>

          <div className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4">
            <div className="space-y-1">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                Available Timeframes
              </p>
              <p className="text-xs text-[var(--muted)]">
                Enter the set of time intervals you are available to teach for each day. Separate multiple intervals with commas (e.g. "9:30am-11am, 3pm-5pm"). Partial hours are allowed. Leave blank if you are not available on that day.
              </p>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Tip: The wider your available timeframes are, the higher the chance to have more students. Please put your full availability.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {DAYS_OF_WEEK.map(day => (
                <div key={day} className="space-y-1">
                  <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    {day}
                  </label>
                  <input
                    type="text"
                    value={timeframes[day] || ""}
                    onChange={(e) => handleTimeframeChange(day, e.target.value)}
                    placeholder="e.g. 9am-11am, 3pm-5pm (leave blank for no availability)"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Frequency
            </label>
            <input
              type="text"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
              placeholder="e.g. Weekly, Twice per week"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">You can enter multiple frequencies separated by commas (e.g., "Weekly, Twice per week").</p>
          </div>

          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Total Number of Classes
            </label>
            <input
              type="number"
              min={1}
              value={totalClasses}
              onChange={(event) => setTotalClasses(parseInt(event.target.value) || 1)}
              placeholder="e.g. 8"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              required
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">Specify exactly how many classes this course should consist of.</p>
          </div>

          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Proposed Start Date
            </label>
            <div className="mt-2">
              <DatePicker
                selected={startDate}
                onChange={(date: Date | null) => setStartDate(date)}
                dateFormat="yyyy-MM-dd"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                placeholderText="Click to select a date"
                required
              />
            </div>
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">What is your earliest start date for teaching this course?</p>
          </div>

          <div>
            <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
              Notes for Founders (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Any additional information you want the founders to know."
              rows={3}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
          </div>

          <div className="space-y-4 rounded-xl border border-[var(--border)] px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Co-teach this course
                </label>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Check this box if this course will be co-taught with another tutor.
                </p>
              </div>
              <input
                type="checkbox"
                checked={isCoTaught}
                onChange={(e) => {
                  if (e.target.checked) {
                    const confirmed = window.confirm("This is only allowed if you have been given permission to do so as co-taught courses are not conventional.");
                    if (confirmed) {
                      setIsCoTaught(true);
                    }
                  } else {
                    setIsCoTaught(false);
                    setCoTutorId("");
                  }
                }}
                className="h-5 w-5 rounded border-[var(--border)] text-[var(--foreground)] focus:ring-[var(--foreground)]"
              />
            </div>
            {isCoTaught && (
              <div className="pt-2">
                <label className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Select Secondary Tutor
                </label>
                <select
                  value={coTutorId}
                  onChange={(e) => setCoTutorId(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  required={isCoTaught}
                >
                  <option value="" disabled>Select a tutor...</option>
                  {availableTutors.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <button
                type="button"
                className="w-1/3 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70 ${onCancel ? "w-2/3" : ""}`}
            >
              {isSubmitting ? "Submitting..." : editData ? "Save changes" : "Submit course request"}
            </button>
          </div>
        </form>
      </div>

      {showConfirmModal && (
        <div className="fixed top-0 left-0 z-[60] flex h-[100dvh] w-[100dvw] items-center justify-center p-4">
          <div className="absolute inset-0 bg-transparent" onClick={() => setShowConfirmModal(false)}></div>
          <div className="relative w-full max-w-md animate-in fade-in zoom-in duration-200 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">Important Confirmation</h3>
            <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
              Please make sure that the course length (number of classes) is long enough to covering all topics, because extending the course after submitting this request is very unlikely. This is especially important if this course involves a grade-specific curriculum, as you must cover all topics in this curriculum.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)] transition"
              >
                Go back
              </button>
              <button
                onClick={proceedWithSubmission}
                className="rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] hover:opacity-90 transition"
              >
                I'm sure, submit request
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
