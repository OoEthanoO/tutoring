"use client";

import { useState } from "react";

type FormState = {
  guardianEmail: string;
  studentFullName: string;
  schoolName: string;
  grade: string;
  parentGuardianName: string;
  parentGuardianPhone: string;
  consentName: string;
};

type Props = {
  initialGrade?: string | null;
  initialSchool?: string | null;
  initialStudentName?: string | null;
  onSubmit: (data: FormState) => Promise<void>;
  onCancel?: () => void;
  isConfirmDisabled?: boolean;
  isSubmitting: boolean;
  isFull?: boolean;
  isEnrolled?: boolean;
  enrollmentStatus?: string | null;
};

export default function StudentApplicationForm({
  initialGrade,
  initialSchool,
  initialStudentName,
  onSubmit,
  onCancel,
  isConfirmDisabled,
  isSubmitting,
  isFull,
  isEnrolled,
  enrollmentStatus,
}: Props) {
  const sanitizedInitialGrade = initialGrade?.replace(/^G/i, "") || "5";

  const [form, setForm] = useState<FormState>({
    guardianEmail: "",
    studentFullName: initialStudentName || "",
    schoolName: initialSchool || "",
    grade: sanitizedInitialGrade,
    parentGuardianName: "",
    parentGuardianPhone: "",
    consentName: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { id, value } = e.target;
    setForm((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isFull && !isEnrolled && (
        <div className="space-y-4 rounded-xl border border-[var(--border)] p-4 bg-[var(--surface-raised)]">
          <h4 className="text-sm font-semibold text-[var(--foreground)]">YanLearn Student Application Form</h4>
          
          <div className="space-y-1">
            <label htmlFor="guardianEmail" className="text-xs font-medium text-[var(--muted)]">
              Guardian&apos;s email address *
            </label>
            <input
              id="guardianEmail"
              type="email"
              required
              value={form.guardianEmail}
              onChange={handleChange}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="studentFullName" className="text-xs font-medium text-[var(--muted)]">
              Student full name *
            </label>
            <input
              id="studentFullName"
              type="text"
              required
              value={form.studentFullName}
              onChange={handleChange}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="schoolName" className="text-xs font-medium text-[var(--muted)]">
                School name *
              </label>
              <input
                id="schoolName"
                type="text"
                required
                value={form.schoolName}
                onChange={handleChange}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="grade" className="text-xs font-medium text-[var(--muted)]">
                Grade *
              </label>
              <select
                id="grade"
                required
                value={form.grade}
                onChange={handleChange}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
              >
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
                <option value="10">10</option>
                <option value="11">11</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="parentGuardianName" className="text-xs font-medium text-[var(--muted)]">
                Parent/Guardian&apos;s Name *
              </label>
              <input
                id="parentGuardianName"
                type="text"
                required
                value={form.parentGuardianName}
                onChange={handleChange}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="parentGuardianPhone" className="text-xs font-medium text-[var(--muted)]">
                Parent/Guardian Phone Number *
              </label>
              <input
                id="parentGuardianPhone"
                type="tel"
                required
                value={form.parentGuardianPhone}
                onChange={handleChange}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">
              Consent Form *
            </label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-relaxed text-[var(--muted)]">
              I agree that my participation in this is a collaborative online tutoring program. My child and the tutor have a mutual selection process. I understand that the tutor uses their knowledge and skills to provide tutoring for my child, and my supervision of my child&apos;s attendance helps the tutor gain practical experience. I agree that I have a responsibility to supervise the tutoring process when my child receives online tutoring at home. I understand that I have the right to withdraw from tutoring at any time for a reasonable reason. I agree that this program is conducted on a semester basis, and there may be intervals between activities. I understand that each tutoring session typically lasts 45-60 minutes, conducted by the tutor in a Zoom meeting room. I agree that the tutor may extend the tutoring session depending on the specific circumstances, but in principle, the total time will not exceed 60 minutes. I agree to help my child set up their equipment in advance and log in to the designated Zoom meeting room using their own email address. I understand that I have an obligation to provide feedback to the assigned parent during tutoring sessions. I understand that even after the application is approved, there is no guarantee that a suitable tutor will be found quickly, but my child may enter the tutor&apos;s meeting room to observe with the consent of the assigned parent or Tutor Lead, provided that it does not interfere with the tutor&apos;s tutoring of other students. I understand that I must promptly notify the tutor if my child is unable to attend a tutoring session. I agree that the relationship between counselors and students should be one of mutual respect and equality. I understand that there is zero tolerance for any inappropriate language or behavior during the counseling process. I agree that WSYA and its volunteers bear no legal responsibility for the content or effectiveness of the counseling. I know that counselors provide counseling based on their own knowledge and skills, and I have a responsibility to help my own child acquire the correct knowledge. I agree to waive, discharge, and covenant not to sue the Waterloo Youth Companion Program, its governing volunteers, counselors, or volunteers from any and all liability to the participant, myself, or the participant&apos;s heirs and next of kin for any and all claims, demands, losses, or damages.
            </div>
            <p className="text-[10px] text-[var(--muted)]">If you agree, please sign the guardian&apos;s full name below.</p>
            <input
              id="consentName"
              type="text"
              required
              placeholder="Full Name"
              value={form.consentName}
              onChange={handleChange}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 isolate">
        {onCancel && (
          <button
            key="cancel-button"
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--foreground)] disabled:opacity-50"
          >
            <span key={isSubmitting ? "cancelling" : "cancel"}>Cancel</span>
          </button>
        )}
        <button
          key="submit-button"
          type="submit"
          disabled={isSubmitting || isConfirmDisabled}
          style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
          className="rounded-full bg-[var(--foreground)] px-6 py-2 text-xs font-semibold text-[var(--surface)] hover:opacity-90 disabled:opacity-50 min-w-[140px]"
        >
          <span key={isSubmitting ? "submitting" : "idle"}>
            {isSubmitting 
              ? "Enrolling..." 
              : enrollmentStatus === "pending"
                ? "Under Review"
                : enrollmentStatus === "rejected"
                  ? "Rejected"
                  : isEnrolled 
                    ? "Already Enrolled" 
                    : isFull 
                      ? "Course Full" 
                      : "Submit Enrollment Request"}
          </span>
        </button>
      </div>
    </form>
  );
}
