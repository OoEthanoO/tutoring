"use client";

import { useEffect, useMemo, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { suggestNextClassStart } from "@/lib/classSchedule";
import { MAX_PAID_FEE, MIN_PAID_FEE, normalizePaidFee } from "@/lib/paidCourses";
import {
  MAX_CLASS_MINUTES,
  MAX_COURSE_DESCRIPTION_LENGTH,
  MAX_COURSE_STUDENTS,
  MAX_COURSE_TITLE_LENGTH,
  MIN_CLASS_MINUTES,
} from "@/lib/newCourse";

/**
 * Management creates a course straight away, without a course request
 * (api/admin/courses). Same fields an approval sets, plus the ones the
 * request would have carried: title, description, tutors, recordings, paid.
 */

type Tutor = { id: string; name: string; seniorTutor: boolean; hasPaymentNote: boolean };
type DraftClass = { startsAt: string; durationHours: number; tutorId: string };

const labelClass = "text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]";
const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]";

export default function CourseDirectCreator({
  onCreated,
  onCancel,
}: {
  onCreated: (result: { title: string; tutorName: string; announced: boolean; classesAdded: boolean }) => void;
  onCancel: () => void;
}) {
  const [tutors, setTutors] = useState<Tutor[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [coTutorId, setCoTutorId] = useState("");
  const [maxStudents, setMaxStudents] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [paidFee, setPaidFee] = useState("");
  const [donationFee, setDonationFee] = useState("");
  const [recordingsEnabled, setRecordingsEnabled] = useState(true);
  const [draftStartsAt, setDraftStartsAt] = useState<Date | null>(null);
  const [draftMinutes, setDraftMinutes] = useState("60");
  const [draftTutorId, setDraftTutorId] = useState("");
  const [classes, setClasses] = useState<DraftClass[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/courses");
        const data = (await res.json().catch(() => null)) as
          | { tutors?: Tutor[]; currentUserId?: string; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !data?.tutors) {
          setLoadError(data?.error || "Could not load the tutors.");
          return;
        }
        setTutors(data.tutors);
        // Management teaching its own course is the common case.
        if (data.currentUserId && data.tutors.some((tutor) => tutor.id === data.currentUserId)) {
          setOwnerId(data.currentUserId);
        }
      } catch {
        if (!cancelled) setLoadError("Could not load the tutors.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map((tutors ?? []).map((tutor) => [tutor.id, tutor])), [tutors]);
  const owner = byId.get(ownerId) ?? null;
  const coTutor = coTutorId ? byId.get(coTutorId) ?? null : null;
  const teachers = [owner, coTutor].filter((tutor): tutor is Tutor => Boolean(tutor));
  const nameOf = (id: string) => byId.get(id)?.name ?? "Tutor";

  // Shown before submitting; the server enforces the same rule (PAID_COURSES.md).
  const paidProblems = isPaid
    ? teachers.flatMap((tutor) => [
        ...(tutor.seniorTutor ? [] : [`${tutor.name} is not a senior tutor.`]),
        ...(tutor.hasPaymentNote ? [] : [`${tutor.name} has no payment note.`]),
      ])
    : [];

  const changeCoTutor = (id: string) => {
    setCoTutorId(id);
    // Classes taught by a co-tutor who is no longer on the course go back to the tutor.
    setClasses((items) => items.map((item) => (item.tutorId === ownerId || item.tutorId === id ? item : { ...item, tutorId: ownerId })));
    setDraftTutorId("");
  };

  const changeOwner = (id: string) => {
    const previous = ownerId;
    setOwnerId(id);
    if (coTutorId === id) setCoTutorId("");
    setClasses((items) => items.map((item) => (item.tutorId === previous || item.tutorId === id ? { ...item, tutorId: id } : item)));
    setDraftTutorId("");
  };

  const addClass = () => {
    setError("");
    if (!draftStartsAt) {
      setError("Pick the class's date and time first.");
      return;
    }
    const minutes = Number.parseInt(draftMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < MIN_CLASS_MINUTES || minutes > MAX_CLASS_MINUTES) {
      setError(`A class lasts from ${MIN_CLASS_MINUTES} minutes to ${MAX_CLASS_MINUTES / 60} hours.`);
      return;
    }
    const startsAt = draftStartsAt.toISOString();
    if (classes.some((item) => item.startsAt === startsAt)) {
      setError("There is already a class at that time.");
      return;
    }
    const next = [...classes, { startsAt, durationHours: minutes / 60, tutorId: draftTutorId || ownerId }].sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)
    );
    setClasses(next);
    const suggested = suggestNextClassStart(next.map((item) => item.startsAt));
    if (suggested) setDraftStartsAt(suggested);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give the course a title.");
      return;
    }
    if (!ownerId) {
      setError("Choose the tutor who teaches the course.");
      return;
    }
    if (isPaid && normalizePaidFee(paidFee) === null) {
      setError(`Enter the course fee: a dollar amount from $${MIN_PAID_FEE} to $${MAX_PAID_FEE}.`);
      return;
    }
    if (paidProblems.length > 0) {
      setError(`A paid course needs senior tutors with payment notes. ${paidProblems.join(" ")}`);
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          ownerId,
          coTutorId: coTutorId || null,
          isPaid,
          paidFee: isPaid ? Number(paidFee) : null,
          donationFee: !isPaid && donationFee.trim() ? Number(donationFee) : null,
          maxStudents: maxStudents.trim() ? Number(maxStudents) : null,
          gradeLevel: gradeLevel ? Number(gradeLevel) : null,
          recordingsEnabled,
          classes: classes.map((item) => ({
            startsAt: item.startsAt,
            durationHours: item.durationHours,
            tutorId: item.tutorId === ownerId || item.tutorId === coTutorId ? item.tutorId : ownerId,
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; announced?: boolean; classesAdded?: boolean }
        | null;
      if (!res.ok) {
        setError(data?.error || "Could not create the course.");
        return;
      }
      onCreated({
        title: title.trim(),
        tutorName: nameOf(ownerId),
        announced: data?.announced !== false,
        classesAdded: data?.classesAdded !== false,
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }
  if (!tutors) {
    return <p className="text-sm text-[var(--muted)]">Loading tutors...</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-sm text-[var(--muted)]">
        The course is created straight away, with no request to approve: like an approved request, it is in the Courses catalog and in the tutor&apos;s My courses at once. The tutor gets an email and a YanBot message in the executives channel, unless you are teaching it alone.
      </p>

      <div>
        <label htmlFor="new-course-title" className={labelClass}>Title</label>
        <input id="new-course-title" value={title} maxLength={MAX_COURSE_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Grade 10 Science" className={inputClass} />
      </div>

      <div>
        <label htmlFor="new-course-description" className={labelClass}>Description</label>
        <textarea id="new-course-description" value={description} maxLength={MAX_COURSE_DESCRIPTION_LENGTH} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What students will learn. Families read this on the Courses page." className={inputClass} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-course-owner" className={labelClass}>Tutor</label>
          <select id="new-course-owner" value={ownerId} onChange={(e) => changeOwner(e.target.value)} required className={inputClass}>
            <option value="">Choose a tutor</option>
            {tutors.map((tutor) => (
              <option key={tutor.id} value={tutor.id}>{tutor.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="new-course-cotutor" className={labelClass}>Co-tutor (optional)</label>
          <select id="new-course-cotutor" value={coTutorId} onChange={(e) => changeCoTutor(e.target.value)} disabled={!ownerId} className={`${inputClass} disabled:opacity-50`}>
            <option value="">None</option>
            {tutors.filter((tutor) => tutor.id !== ownerId).map((tutor) => (
              <option key={tutor.id} value={tutor.id}>{tutor.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-course-max" className={labelClass}>Max students</label>
          <input id="new-course-max" type="number" min="1" max={MAX_COURSE_STUDENTS} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="Leave blank for unlimited" className={inputClass} />
        </div>
        <div>
          <label htmlFor="new-course-grade" className={labelClass}>Grade level</label>
          <select id="new-course-grade" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className={inputClass}>
            <option value="">Not specified (1.5 service hrs / class)</option>
            {[6, 7, 8, 9, 10, 11, 12].map((grade) => (
              <option key={grade} value={grade}>
                Grade {grade} ({grade >= 11 ? "2" : "1.5"} service hrs / class)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-start gap-3">
          <input id="new-course-paid" type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:ring-0" />
          <div className="flex-1">
            <label htmlFor="new-course-paid" className="text-sm font-semibold text-[var(--foreground)]">Paid course</label>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {isPaid
                ? "Families pay this fee straight to the tutor, not to SickKids, and the course earns no community service hours. The tutor (and any co-tutor) must be a senior tutor with a payment note."
                : "Leave unticked for a free course with an optional SickKids donation."}
            </p>
            {isPaid ? (
              <div className="mt-3">
                <label htmlFor="new-course-fee" className={labelClass}>Course fee for the whole course, in dollars</label>
                <input id="new-course-fee" type="number" min={MIN_PAID_FEE} max={MAX_PAID_FEE} step="0.01" required value={paidFee} onChange={(e) => setPaidFee(e.target.value)} className={inputClass} />
                {paidProblems.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold text-amber-600">{paidProblems.join(" ")}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3">
                <label htmlFor="new-course-donation" className={labelClass}>Donation fee</label>
                <input id="new-course-donation" type="number" min="0" step="1" value={donationFee} onChange={(e) => setDonationFee(e.target.value)} placeholder="0 or leave blank for none" className={inputClass} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-start gap-3">
          <input id="new-course-recordings" type="checkbox" checked={recordingsEnabled} onChange={(e) => setRecordingsEnabled(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] focus:ring-0" />
          <div>
            <label htmlFor="new-course-recordings" className="text-sm font-semibold text-[var(--foreground)]">Record classes with YanLearn Recorder</label>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {recordingsEnabled
                ? "The tutor runs YanLearn Recorder for every class. Recordings are visible only to enrolled students and are deleted after 7 days."
                : "This course will not be recorded, and the tutor will not be asked to open YanLearn Recorder for it."}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
        <p className={labelClass}>Classes</p>
        <p className="text-xs text-[var(--muted)]">Optional now: the tutor can add more in My courses.</p>
        <div className={`grid gap-3 ${coTutor ? "sm:grid-cols-[1fr_auto_auto]" : "sm:grid-cols-[1fr_auto]"}`}>
          <div className="min-w-0 space-y-1">
            <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Date &amp; time</label>
            <DatePicker
              selected={draftStartsAt}
              onChange={(date: Date | null) => setDraftStartsAt(date)}
              showTimeSelect
              dateFormat="Pp"
              placeholderText="Pick a date and time"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-course-minutes" className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Duration (min)</label>
            <input id="new-course-minutes" type="number" min={MIN_CLASS_MINUTES} max={MAX_CLASS_MINUTES} value={draftMinutes} onChange={(e) => setDraftMinutes(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]" />
          </div>
          {coTutor && owner ? (
            <div className="space-y-1">
              <label htmlFor="new-course-class-tutor" className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Tutor</label>
              <select id="new-course-class-tutor" value={draftTutorId || ownerId} onChange={(e) => setDraftTutorId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]">
                <option value={owner.id}>{owner.name}</option>
                <option value={coTutor.id}>{coTutor.name}</option>
              </select>
            </div>
          ) : null}
          <button type="button" onClick={addClass} disabled={!ownerId} className={`rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold transition hover:bg-[var(--border)] disabled:opacity-50 ${coTutor ? "sm:col-span-3" : "sm:col-span-2"}`}>
            Add class
          </button>
        </div>
        {classes.length > 0 ? (
          <ul className="space-y-2 text-xs">
            {classes.map((item, index) => (
              <li key={item.startsAt} className="flex flex-col justify-between gap-2 rounded border border-[var(--border)] p-2 sm:flex-row sm:items-center">
                <span>
                  Class {index + 1} - {new Date(item.startsAt).toLocaleString()} ({Math.round(item.durationHours * 60)}m)
                  {coTutor ? ` - ${nameOf(item.tutorId)}` : ""}
                </span>
                <button type="button" onClick={() => setClasses((items) => items.filter((_, position) => position !== index))} className="self-start text-red-500 hover:underline sm:self-auto">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="w-1/3 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--border)] hover:text-[var(--foreground)]">
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} className="flex-1 rounded-full bg-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--background)] transition hover:bg-[var(--foreground)]/90 disabled:opacity-50">
          {isSubmitting ? "Creating..." : "Create course"}
        </button>
      </div>
    </form>
  );
}
