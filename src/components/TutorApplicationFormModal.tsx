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

            {/* Tutor Legal Consent Scroll Block */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--muted)]">
                Tutor Consent & Honor Agreement *
              </label>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[11px] leading-relaxed text-[var(--muted)] scrollbar-thin">
                <p className="font-semibold mb-2 text-[var(--foreground)]">
                  Please read the following agreement carefully:
                </p>
                <p className="mb-2">
                  I agree to participate as a tutor/executive in the YanLearn peer tutoring program. I understand that my involvement is a voluntary contribution to the community, and I agree to uphold the highest standards of professional conduct, empathy, and educational support.
                </p>
                <ul className="list-decimal pl-4 space-y-2 mb-2">
                  <li>
                    <strong>Punctuality & Reliability:</strong> I will attend all my scheduled tutoring sessions punctually. If I am unable to attend due to an emergency or illness, I will notify the student and/or parent as well as the Tutor Lead/Executive team at least 24 hours in advance.
                  </li>
                  <li>
                    <strong>Appropriate Communication:</strong> I will maintain clean, supportive, and appropriate communication with my students at all times, adhering strictly to the designated YanLearn servers and authorized Discord channels.
                  </li>
                  <li>
                    <strong>Professional Safety:</strong> I will not engage in any form of inappropriate contact, harassment, discrimination, or share any personal/unapproved content with students.
                  </li>
                  <li>
                    <strong>Truthful Reporting:</strong> I agree to accurately log my teaching sessions and ensure that my community service hour claims are 100% truthful and represent actual time taught (where each standard class yields 1.5 hours).
                  </li>
                  <li>
                    <strong>Compliance & Enforcement:</strong> I understand that YanLearn has a zero-tolerance policy for code of conduct violations, which can result in immediate termination, suspension of community service hours, or removal of executive roles.
                  </li>
                  <li>
                    <strong>Liability Release:</strong> I agree to waive, discharge, and covenant not to sue YanLearn, its volunteers, founders, and governing members from any and all liability, claims, or losses arising from my participation in this program.
                  </li>
                </ul>
                <p>
                  By signing below, I certify that I have read, understood, and agreed to be bound by the terms and conditions outlined in this YanLearn Tutor Consent & Honor Agreement.
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
