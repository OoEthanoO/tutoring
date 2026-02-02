"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveRole } from "@/lib/roles";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setIsSubmitting(true);

    try {
      if (mode === "signup") {
        if (!fullName.trim()) {
          throw new Error("Full name is required for sign up.");
        }
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        setStatus(
          "Check your inbox to confirm your email. You can sign in after verification."
        );
      } else {
        const { error: signInError, data } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });

        if (signInError) {
          throw signInError;
        }

        const fullNameValue = data.user?.user_metadata?.full_name;
        if (!fullNameValue || String(fullNameValue).trim().length === 0) {
          router.replace("/onboarding");
          return;
        }

        const role = resolveRole(data.user?.email);
        router.replace(role === "founder" ? "/admin" : "/student");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16">
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Access
          </p>
          <h1 className="text-3xl font-semibold text-[var(--foreground)]">
            Sign in or create an account
          </h1>
          <p className="text-sm text-[var(--muted)]">
            We route you to the right dashboard based on your role.
          </p>
        </section>

        <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
          <div className="mb-6 inline-flex rounded-full border border-[var(--border)] p-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`rounded-full px-4 py-2 transition ${
                mode === "signin"
                  ? "bg-[var(--foreground)] text-white"
                  : "text-[var(--muted)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`rounded-full px-4 py-2 transition ${
                mode === "signup"
                  ? "bg-[var(--foreground)] text-white"
                  : "text-[var(--muted)]"
              }`}
            >
              Sign up
            </button>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Email
              </label>
              <input
                type="email"
                placeholder="you@nonprofit.org"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                required
              />
            </div>
            {mode === "signup" ? (
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
            ) : null}
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                required
                minLength={8}
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
              {isSubmitting
                ? "Working..."
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Make sure your email is verified before signing in.
          </p>
        </div>
      </div>
    </div>
  );
}
