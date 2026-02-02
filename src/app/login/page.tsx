"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

        router.replace("/");
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
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold">Sign in</h1>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded border px-3 py-2 text-sm ${
              mode === "signin"
                ? "border-[var(--foreground)]"
                : "border-[var(--border)]"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded border px-3 py-2 text-sm ${
              mode === "signup"
                ? "border-[var(--foreground)]"
                : "border-[var(--border)]"
            }`}
          >
            Sign up
          </button>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-[var(--muted)]">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--foreground)]"
              required
            />
          </div>
          {mode === "signup" ? (
            <div>
              <label className="text-xs text-[var(--muted)]">Full name</label>
              <input
                type="text"
                placeholder="Alex Johnson"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--foreground)]"
                required
              />
            </div>
          ) : null}
          <div>
            <label className="text-xs text-[var(--muted)]">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--foreground)]"
              required
              minLength={8}
            />
          </div>
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          {status ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {status}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded border border-[var(--foreground)] px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting
              ? "Working..."
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
