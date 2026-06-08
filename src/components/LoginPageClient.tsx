"use client";

import { useState, type FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { broadcastAuthChange } from "@/lib/authClient";
import { setHasUnsavedData } from "@/lib/unsavedData";

type Mode = "signin" | "signup" | "forgot";

export default function LoginPageClient({ maintenanceEnabled = false }: { maintenanceEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [resendSending, setResendSending] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signupConfirmStep, setSignupConfirmStep] = useState<0 | 1 | 2>(0);
  const router = useRouter();

  useEffect(() => {
    const hasUnsavedAuth =
      email.length > 0 || password.length > 0 || fullName.length > 0;
    setHasUnsavedData("login-page", hasUnsavedAuth);
    return () => setHasUnsavedData("login-page", false);
  }, [email, password, fullName]);

  const performSignup = async () => {
    setError("");
    setStatus("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          fullName: fullName.trim(),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Unable to sign up.");
      }

      setStatus(
        "Check your inbox to confirm your email. You can sign in after verification. There might be a delay between clicking create account and the verification email getting sent."
      );
      setSignupConfirmStep(0);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setIsSubmitting(true);

    try {
      if (mode === "forgot") {
        const response = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error ?? "Unable to send reset link.");
        }

        setStatus(
          "If an account with that email exists, a password reset link has been sent. Please check your inbox."
        );
      } else if (mode === "signup") {
        if (!fullName.trim()) {
          throw new Error("Full name is required for sign up.");
        }
        setSignupConfirmStep(1);
        setIsSubmitting(false);
        return;
      } else {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error ?? "Unable to sign in.");
        }

        const payload = (await response.json()) as {
          user: { full_name?: string | null };
        };

        broadcastAuthChange();

        const fullNameValue = payload.user?.full_name;
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
      {signupConfirmStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Confirm Details</h2>
            {signupConfirmStep === 1 ? (
              <p className="mb-6 text-sm">Are you using the child&apos;s full name?</p>
            ) : (
              <p className="mb-6 text-sm">Are you using the child&apos;s email address?</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setSignupConfirmStep(0)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-muted)]"
              >
                No
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  if (signupConfirmStep === 1) {
                    setSignupConfirmStep(2);
                  } else {
                    performSignup();
                  }
                }}
                className="rounded-full bg-[var(--foreground)] text-[var(--background)] px-4 py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Working..." : "Yes"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold">Sign in</h1>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-400">
          <p className="font-semibold">Notice:</p>
          <p className="mt-1">
            {mode === "signup" ? (
              <>
                Please use <strong>the child&apos;s personal email</strong> (e.g., Gmail, Outlook, iCloud) instead of a school email. School filters often block our verification and automated notification emails.
                <br />
                <br />
                Please also make sure to use <strong>the child&apos;s full name</strong>.
                <br />
                <br />
              </>
            ) : null}
            Please do not create multiple accounts. Only use one account to
            manage your courses and settings. This is to ensure you can easily
            keep track of your enrollments and Discord access. If you have already
            created an account, please log in to your previous account.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded border px-3 py-2 text-sm ${mode === "signin"
              ? "border-[var(--foreground)]"
              : "border-[var(--border)]"
              }`}
          >
            Sign in
          </button>
          {!maintenanceEnabled ? (
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`rounded border px-3 py-2 text-sm ${mode === "signup"
                ? "border-[var(--foreground)]"
                : "border-[var(--border)]"
                }`}
            >
              Sign up
            </button>
          ) : null}
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
          {mode !== "forgot" ? (
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
              {mode === "signin" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError("");
                    setStatus("");
                  }}
                  className="mt-1 text-xs text-[var(--muted)] underline transition hover:text-[var(--foreground)]"
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {error}
              {String(error).toLowerCase().includes("verify your email") ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!email) {
                        setError("Please enter your email above to resend verification.");
                        return;
                      }
                      setResendSending(true);
                      setResendSent(false);
                      try {
                        const response = await fetch("/api/auth/resend", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email }),
                        });
                        if (response.ok) {
                          setResendSent(true);
                          setStatus("Verification email resent. Check your inbox.");
                        } else {
                          setError("Unable to resend verification. Please try again later.");
                        }
                      } catch (e) {
                        setError("Unable to resend verification. Please try again later.");
                      } finally {
                        setResendSending(false);
                      }
                    }}
                    disabled={resendSending || resendSent}
                    className="ml-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold"
                  >
                    {resendSending ? "Sending..." : resendSent ? "Sent" : "Resend verification email"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {status ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
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
              : mode === "forgot"
                ? "Send reset link"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
          </button>
          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError("");
                setStatus("");
              }}
              className="w-full text-xs text-[var(--muted)] underline transition hover:text-[var(--foreground)]"
            >
              Back to sign in
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
