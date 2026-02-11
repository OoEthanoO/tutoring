"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { iteration } from "@/lib/iteration";

export default function Footer() {
  const [isCreditHovered, setIsCreditHovered] = useState(false);
  const [isFeedbackHovered, setIsFeedbackHovered] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{
    type: "idle" | "error" | "success";
    message: string;
  }>({ type: "idle", message: "" });

  useEffect(() => {
    const checkIteration = async () => {
      try {
        const response = await fetch(
          `/api/iteration?ts=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { iteration?: string };
        const serverIteration = data.iteration ?? iteration;
        if (serverIteration !== iteration) {
          window.location.reload();
        }
      } catch {
        // Ignore iteration check errors.
      }
    };

    checkIteration();
    const interval = window.setInterval(checkIteration, 15000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();
    return onAuthChange(load);
  }, []);

  const onSubmitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingFeedback) {
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackStatus({ type: "idle", message: "" });
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to send feedback.");
      }

      setMessage("");
      setFeedbackStatus({
        type: "success",
        message: "Thanks. Your feedback has been sent.",
      });
    } catch (error) {
      setFeedbackStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unable to send feedback.",
      });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  return (
    <footer className="mt-auto border-t border-[var(--border)] pt-6 text-center text-xs text-[var(--muted)]">
      <p>
        <a
          href="https://ethanyanxu.com"
          target="_blank"
          rel="noreferrer"
          className="transition-colors"
          onMouseEnter={() => setIsCreditHovered(true)}
          onMouseLeave={() => setIsCreditHovered(false)}
          onFocus={() => setIsCreditHovered(true)}
          onBlur={() => setIsCreditHovered(false)}
        >
          <span style={{ color: isCreditHovered ? "#3b82f6" : "var(--muted)" }}>
            Made with ❤️ by Ethan Yan Xu
          </span>
        </a>{" "}
        | Iteration {iteration}
        {isSignedIn ? (
          <>
            {" "}
            |{" "}
            <button
              type="button"
              className="transition-colors"
              onMouseEnter={() => setIsFeedbackHovered(true)}
              onMouseLeave={() => setIsFeedbackHovered(false)}
              onFocus={() => setIsFeedbackHovered(true)}
              onBlur={() => setIsFeedbackHovered(false)}
              onClick={() => {
                setFeedbackStatus({ type: "idle", message: "" });
                setIsFeedbackOpen(true);
              }}
            >
              <span
                style={{
                  color: isFeedbackHovered ? "#3b82f6" : "var(--muted)",
                }}
              >
                Send Feedback
              </span>
            </button>
          </>
        ) : null}
      </p>
      {isFeedbackOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-left">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Feedback
              </p>
              <h3 className="text-lg font-semibold text-[var(--foreground)]">
                Send feedback
              </h3>
            </div>
            <form className="space-y-4" onSubmit={onSubmitFeedback}>
              <div>
                <label className="text-xs text-[var(--muted)]">Message</label>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="mt-2 min-h-32 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  placeholder="Write your feedback..."
                  required
                  minLength={10}
                  maxLength={2000}
                />
              </div>
              {feedbackStatus.type !== "idle" ? (
                <p
                  className={
                    feedbackStatus.type === "success"
                      ? "text-xs text-emerald-500"
                      : "text-xs text-red-500"
                  }
                >
                  {feedbackStatus.message}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  onClick={() => setIsFeedbackOpen(false)}
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFeedback}
                  className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmittingFeedback ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </footer>
  );
}
