"use client";

import { useEffect, useState } from "react";

type EmailHistoryEntry = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  createdAt: string;
  lastEvent: string | null;
};

type EmailHistoryDetail = {
  html: string | null;
  text: string | null;
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

export default function EmailHistoryMenu() {
  const [emails, setEmails] = useState<EmailHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, EmailHistoryDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    const fetchEmails = async () => {
      setIsLoading(true);
      setError("");
      const response = await fetch("/api/admin/emails");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Unable to load email history.");
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as {
        emails?: EmailHistoryEntry[];
        hasMore?: boolean;
        nextCursor?: string | null;
      };
      setEmails(data.emails ?? []);
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
      setIsLoading(false);
    };

    fetchEmails();
  }, []);

  const loadMore = async () => {
    if (!cursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setError("");
    const response = await fetch(
      `/api/admin/emails?after=${encodeURIComponent(cursor)}`
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Unable to load more emails.");
      setIsLoadingMore(false);
      return;
    }

    const data = (await response.json()) as {
      emails?: EmailHistoryEntry[];
      hasMore?: boolean;
      nextCursor?: string | null;
    };
    setEmails((current) => [...current, ...(data.emails ?? [])]);
    setHasMore(Boolean(data.hasMore));
    setCursor(data.nextCursor ?? null);
    setIsLoadingMore(false);
  };

  const toggleDetail = async (id: string) => {
    setDetailError("");
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    if (details[id]) {
      return;
    }

    setLoadingDetailId(id);
    const response = await fetch(`/api/admin/emails?id=${encodeURIComponent(id)}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setDetailError(payload?.error ?? "Unable to load email contents.");
      setLoadingDetailId(null);
      return;
    }

    const data = (await response.json()) as { email?: EmailHistoryDetail };
    setDetails((current) => ({
      ...current,
      [id]: {
        html: data.email?.html ?? null,
        text: data.email?.text ?? null,
      },
    }));
    setLoadingDetailId(null);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Email history
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Emails
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Every email sent through the platform, including ones sent before this
          view existed. Click an email to read its contents.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading email history...</p>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {!isLoading && !error && emails.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No emails sent yet.</p>
      ) : null}
      {!isLoading && emails.length > 0 ? (
        <div className="space-y-2">
          {emails.map((email) => {
            const isExpanded = expandedId === email.id;
            const detail = details[email.id];
            return (
              <div
                key={email.id}
                className="space-y-2 rounded-xl border border-[var(--border)] px-3 py-3"
              >
                <button
                  type="button"
                  onClick={() => toggleDetail(email.id)}
                  className="flex w-full flex-col gap-1 text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--muted)]">
                      {email.createdAt ? formatDate(email.createdAt) : "Unknown time"}
                    </p>
                    {email.lastEvent ? (
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {email.lastEvent.replace(/[._]/g, " ")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {email.subject}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    To: {email.to.length > 0 ? email.to.join(", ") : "Unknown"}
                  </p>
                  {email.from ? (
                    <p className="text-xs text-[var(--muted)]">From: {email.from}</p>
                  ) : null}
                </button>
                {isExpanded ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    {loadingDetailId === email.id ? (
                      <p className="text-sm text-[var(--muted)]">Loading contents...</p>
                    ) : detailError ? (
                      <p className="text-sm text-red-500">{detailError}</p>
                    ) : detail?.html ? (
                      <div
                        className="max-h-96 overflow-auto text-sm text-[var(--foreground)]"
                        dangerouslySetInnerHTML={{ __html: detail.html }}
                      />
                    ) : detail?.text ? (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm text-[var(--foreground)]">
                        {detail.text}
                      </pre>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        No contents available for this email.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className="w-full rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
