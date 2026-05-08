"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { setHasUnsavedData, hasAnyUnsavedData } from "@/lib/unsavedData";

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

  const [totalCommits, setTotalCommits] = useState<number | null>(null);
  const [pendingCommitCount, setPendingCommitCount] = useState<number | null>(null);
  const [isCommitHovered, setIsCommitHovered] = useState(false);
  const lastDismissedCommitCountRef = useRef<number | null>(null);

  useEffect(() => {
    lastDismissedCommitCountRef.current = Number(
      window.localStorage.getItem("yanlearn_version_prompt_dismissed_commit_count") || ""
    ) || null;

    const checkCommits = async () => {
      try {
        const response = await fetch(
          `/api/commits?ts=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { total: number };

        setTotalCommits((prev) => {
          if (prev !== null && data.total !== prev) {
            if (lastDismissedCommitCountRef.current !== data.total) {
              setPendingCommitCount(data.total);
            }
          }
          return data.total;
        });
      } catch {
        // Ignore errors.
      }
    };

    checkCommits();
    const interval = window.setInterval(checkCommits, 15000);
    return () => window.clearInterval(interval);
  }, []);

  const handleReloadNow = () => {
    if (hasAnyUnsavedData()) {
      setFeedbackStatus({
        type: "error",
        message: "You have unsaved work. Finish that first, then reload when ready.",
      });
      return;
    }

    window.location.reload();
  };

  const handleDismissUpdate = () => {
    if (pendingCommitCount !== null) {
      window.localStorage.setItem(
        "yanlearn_version_prompt_dismissed_commit_count",
        String(pendingCommitCount)
      );
      lastDismissedCommitCountRef.current = pendingCommitCount;
    }
    setPendingCommitCount(null);
  };

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();
    return onAuthChange(load);
  }, []);

  useEffect(() => {
    const hasUnsavedFeedback = isFeedbackOpen && message.trim().length > 0;
    setHasUnsavedData("footer-feedback", hasUnsavedFeedback);
    return () => setHasUnsavedData("footer-feedback", false);
  }, [isFeedbackOpen, message]);

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
      {pendingCommitCount !== null ? (
        <div className="fixed bottom-4 left-1/2 z-[100] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 shadow-xl backdrop-blur-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-left">
              <p className="text-sm font-semibold text-[var(--foreground)]">A newer version is available</p>
              <p className="text-xs text-[var(--muted)]">
                You can reload now, or keep working and reload later when it is convenient.
              </p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={handleDismissUpdate}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--border)]"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handleReloadNow}
                className="rounded-full bg-[var(--foreground)] px-3 py-1.5 text-xs font-semibold text-[var(--background)] transition hover:opacity-90"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4">
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
            Made with ❤️ by Yan Xu
          </span>
        </a>

        {totalCommits !== null ? (
          <a
            href="/commits"
            className="transition-colors"
            onMouseEnter={() => setIsCommitHovered(true)}
            onMouseLeave={() => setIsCommitHovered(false)}
            onFocus={() => setIsCommitHovered(true)}
            onBlur={() => setIsCommitHovered(false)}
          >
            <span style={{ color: isCommitHovered ? "#3b82f6" : "var(--muted)" }}>
              Commit {totalCommits}
            </span>
          </a>
        ) : (
          <span>Loading...</span>
        )}

        {isSignedIn ? (
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
        ) : null}

        <a
          href="https://www.instagram.com/yanlearn/"
          target="_blank"
          rel="noreferrer"
          className="font-bold transition-opacity hover:opacity-80"
        >
          <span
            style={{
              background:
                "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Instagram
          </span>
        </a>
      </div>
      {isFeedbackOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4" onClick={() => setIsFeedbackOpen(false)}>
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-left" onClick={(e) => e.stopPropagation()}>
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
