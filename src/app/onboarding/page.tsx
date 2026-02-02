"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function OnboardingPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    setIsSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: fullName.trim() },
    });

    if (updateError) {
      setError(updateError.message);
    } else {
      setStatus("Thanks! Your profile is updated.");
      router.replace("/");
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16">
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Profile update
          </p>
          <h1 className="text-3xl font-semibold text-[var(--foreground)]">
            Add your full name
          </h1>
          <p className="text-sm text-[var(--muted)]">
            We added this field recently. Please update your profile to
            continue.
          </p>
        </section>
        <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Full name
              </label>
              <input
                type="text"
                placeholder="Alex Johnson"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                required
              />
            </div>
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {error}
              </div>
            ) : null}
            {status ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                {status}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Saving..." : "Save and continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
