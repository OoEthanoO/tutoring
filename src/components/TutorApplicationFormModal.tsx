"use client";

import React, { useState, useRef, useEffect } from "react";

type TutorApplicationFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmitSuccess: () => void;
  initialEmail?: string;
  initialFullName?: string;
};

export default function TutorApplicationFormModal({
  isOpen,
  onClose,
  onSubmitSuccess,
  initialEmail = "",
  initialFullName = "",
}: TutorApplicationFormModalProps) {
  const backdropClickedRef = useRef(false);
  const [fullName, setFullName] = useState(initialFullName);
  const [email, setEmail] = useState(initialEmail);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [currentGrade, setCurrentGrade] = useState("Grade 9");
  const [parentsPhoneNumber, setParentsPhoneNumber] = useState("");
  const [subjectGrades, setSubjectGrades] = useState("");
  const [programmingProficiency, setProgrammingProficiency] = useState("");
  const [debateExperience, setDebateExperience] = useState("");
  const [otherCoursesExperience, setOtherCoursesExperience] = useState("");
  const [consentSignature, setConsentSignature] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial values when they change
  useEffect(() => {
    if (initialFullName) setFullName(initialFullName);
    if (initialEmail) setEmail(initialEmail);
  }, [initialFullName, initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/tutor-application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          phoneNumber,
          currentGrade,
          parentsPhoneNumber,
          subjectGrades,
          programmingProficiency,
          debateExperience,
          otherCoursesExperience,
          consentSignature,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit application.");
      }

      onSubmitSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          backdropClickedRef.current = true;
        } else {
          backdropClickedRef.current = false;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropClickedRef.current) {
          onClose();
        }
        backdropClickedRef.current = false;
      }}
    >
      <div
        className="w-full max-w-xl flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden scale-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between bg-[var(--surface-raised)]">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              YanLearn Executive Tutor Onboarding Form
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Complete this mandatory form to activate your executive tutor access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)] transition"
            aria-label="Close modal"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="flex flex-col p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20 px-4 py-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Legal Full Name */}
            <div className="space-y-1">
              <label htmlFor="modal-fullName" className="text-xs font-semibold text-[var(--muted)]">
                Full Name (Legal Name) *
              </label>
              <input
                id="modal-fullName"
                type="text"
                required
                placeholder="Enter your exact legal name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition"
              />
            </div>

            {/* Email & Phone Number */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="modal-email" className="text-xs font-semibold text-[var(--muted)]">
                  Your Email *
                </label>
                <input
                  id="modal-email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="modal-phoneNumber" className="text-xs font-semibold text-[var(--muted)]">
                  Your Phone Number *
                </label>
                <input
                  id="modal-phoneNumber"
                  type="tel"
                  required
                  placeholder="(123) 456-7890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition"
                />
              </div>
            </div>

            {/* Grade & Parent Phone */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="modal-currentGrade" className="text-xs font-semibold text-[var(--muted)]">
                  Current Grade *
                </label>
                <select
                  id="modal-currentGrade"
                  required
                  value={currentGrade}
                  onChange={(e) => setCurrentGrade(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition"
                >
                  <option value="Grade 9">Grade 9</option>
                  <option value="Grade 10">Grade 10</option>
                  <option value="Grade 11">Grade 11</option>
                  <option value="Grade 12">Grade 12</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="modal-parentsPhoneNumber" className="text-xs font-semibold text-[var(--muted)]">
                  Parents&apos; Phone Number *
                </label>
                <input
                  id="modal-parentsPhoneNumber"
                  type="tel"
                  required
                  placeholder="(123) 456-7890"
                  value={parentsPhoneNumber}
                  onChange={(e) => setParentsPhoneNumber(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition"
                />
              </div>
            </div>

            {/* Subject Grades */}
            <div className="space-y-1">
              <label htmlFor="modal-subjectGrades" className="text-xs font-semibold text-[var(--muted)]">
                If you would like to become a tutor in mathematics, English, French, science, biology, physics, or chemistry, please fill in your most recent grades in the specific subject below.
              </label>
              <textarea
                id="modal-subjectGrades"
                placeholder="Your answer"
                value={subjectGrades}
                onChange={(e) => setSubjectGrades(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition min-h-[80px]"
              />
            </div>

            {/* Programming Proficiency */}
            <div className="space-y-1">
              <label htmlFor="modal-programmingProficiency" className="text-xs font-semibold text-[var(--muted)]">
                If you would like to become a programming course tutor, please fill in the programming languages you are proficient in and your relevant learning and achievements below.
              </label>
              <textarea
                id="modal-programmingProficiency"
                placeholder="Your answer"
                value={programmingProficiency}
                onChange={(e) => setProgrammingProficiency(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition min-h-[80px]"
              />
            </div>

            {/* Debate Experience */}
            <div className="space-y-1">
              <label htmlFor="modal-debateExperience" className="text-xs font-semibold text-[var(--muted)]">
                If you would like to become a tutor for the debate course, please fill in your learning experience and achievements below.
              </label>
              <textarea
                id="modal-debateExperience"
                placeholder="Your answer"
                value={debateExperience}
                onChange={(e) => setDebateExperience(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition min-h-[80px]"
              />
            </div>

            {/* Other Courses Experience */}
            <div className="space-y-1">
              <label htmlFor="modal-otherCoursesExperience" className="text-xs font-semibold text-[var(--muted)]">
                Would you like to teach other courses? Please write it below and provide your learning experience and achievements.
              </label>
              <textarea
                id="modal-otherCoursesExperience"
                placeholder="Your answer"
                value={otherCoursesExperience}
                onChange={(e) => setOtherCoursesExperience(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition min-h-[80px]"
              />
            </div>

            {/* Tutor Legal Consent Scroll Block */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-red-500">
                Consent Form (If you are under 18, please have your parent or guardian sign it) *
              </label>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[11px] leading-relaxed text-[var(--muted)] scrollbar-thin">
                <p className="mb-2">
                  I agree that the parent or guardian of the student have the right join the meeting and supervise the tutoring process at any time.I know it is my right to decide the maximum number of students I can tutor at one time. I know I have the right to withdraw from the tutoring group, but I will have to give valid reasons and withdraw at the end of the current term.
                </p>
                <p className="mb-2">
                  I know I need to get into the meeting 5-10 minutes early, after the tutoring ends I have 20 minutes to fill out and submit the tutoring log. I know I will get 1 hour and 30 minutes of volunteer time for each tutoring session (10 minutes to prepare + 60 minutes to tutor + 20 minutes to fill out and submit a tutorial log). I agree to submit the tutoring log on the day of (and fill in the names of students who attended the tutoring).
                </p>
                <p className="mb-2">
                  I agree that there is mutual respect and equality between tutors, students and parents, and that there is zero tolerance for inappropriate language in the tutoring process.
                </p>
                <p className="mb-2">
                  I know I can choose my own content materials for tutoring.
                </p>
                <p className="mb-2">
                  I agree that tutoring sessions will not be audio-recorded and videotaped.
                </p>
                <p className="mb-2">
                  I am willing to accept other tutors to sit in or assist me in during tutoring, under the condition that it will not impact the effectiveness of the session. I agree to participate in the tutors&apos; experience exchange meetings regularly, share my experience and actively improve my comprehensive tutoring ability.
                </p>
                <p className="mb-2">
                  I agree to participate in the YanLearn under the condition that it will not affect my daily life and academics. I understand that YanLearn will only use my tutoring logs as the basis for calculating the amount of tutoring sessions and providing volunteer hours. I agree to use only publicly available or copyrighted material for tutoring. I agree that YanLearn is not responsible for the content, effectiveness and copyright of the tutoring material. I release, waive, discharge and covenant not to sue the YanLearn, its governors, volunteers from any and all liability to the participant, me, or the participant&apos;s heirs and next of kin for any and all claims, demands, losses or damages.
                </p>
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                To accept the terms above, please sign by typing your full legal name below.
              </p>
              <input
                id="modal-consentSignature"
                type="text"
                required
                placeholder="Type your legal full name to sign"
                value={consentSignature}
                onChange={(e) => setConsentSignature(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)] transition font-medium"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="border-t border-[var(--border)] pt-4 mt-2 flex justify-end gap-3 bg-[var(--surface)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-full border border-[var(--border)] px-5 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--border)] transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-full bg-[var(--foreground)] px-6 py-2 text-xs font-semibold text-[var(--surface)] hover:opacity-90 transition disabled:opacity-50 min-w-[140px] flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[var(--surface)]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                "Submit Onboarding"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
