"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type CommitInfo = {
  hash: string;
  date: string;
  message: string;
  added: number;
  removed: number;
};

const PAGE_SIZE = 20;

export default function CommitsPage() {
  const [totalCommits, setTotalCommits] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<{ commit: CommitInfo; commitNumber: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/commits?page=${page}&limit=${PAGE_SIZE}&ts=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          total: number;
          page: number;
          totalPages: number;
          commits: CommitInfo[];
        };
        setTotalCommits(data.total);
        setTotalPages(data.totalPages);
        setCommits(data.commits || []);
      } catch {
        // Ignore errors.
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [page]);

  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalCommits ?? 0);

  // Close modal on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCommit(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <div className="space-y-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to home
        </Link>
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              History
            </p>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">
              Changes{totalCommits !== null ? ` (${totalCommits})` : ""}
            </h1>
          </div>
          {totalCommits !== null && totalPages > 1 ? (
            <p className="text-xs text-[var(--muted)]">
              {rangeStart}–{rangeEnd} of {totalCommits}
            </p>
          ) : null}
        </header>
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading commits...</p>
      ) : commits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No commits found.</p>
      ) : (
        <div className="space-y-4">
          {commits.map((commit, index) => {
            const commitNumber = (totalCommits ?? 0) - ((page - 1) * PAGE_SIZE + index);
            const dateObj = new Date(commit.date);
            const formattedDate = Number.isNaN(dateObj.getTime())
              ? commit.date
              : dateObj.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });

            const fullMessage = commit.message.trim();
            const MAX_LENGTH = 80;
            const hasNewlines = fullMessage.includes("\n");
            
            let headline = fullMessage;
            if (hasNewlines) {
              headline = fullMessage.split("\n")[0];
            }
            if (headline.length > MAX_LENGTH) {
              headline = headline.substring(0, MAX_LENGTH).trimEnd();
            }
            
            const hasMore = hasNewlines || fullMessage.length > MAX_LENGTH;

            return (
              <div
                key={commit.hash}
                onClick={() => {
                  if (hasMore) setSelectedCommit({ commit, commitNumber });
                }}
                className={`rounded-xl border border-[var(--border)] px-5 py-4 transition-all duration-200 ${
                  hasMore ? "cursor-pointer hover:border-[var(--foreground)]/30 hover:bg-[var(--surface-muted)] hover:-translate-y-0.5 hover:shadow-sm" : "hover:border-[var(--foreground)]/20"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1 overflow-hidden">
                    <div className="text-sm font-semibold text-[var(--foreground)] leading-snug whitespace-pre-wrap break-words">
                      {headline}
                      {hasMore && (
                        <span className="text-[var(--muted)]">...</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted)] font-mono mt-1">
                      <span className="font-sans text-[var(--foreground)]/50">#{commitNumber}</span>{" "}
                      <span className="mx-1 font-sans">•</span>{" "}
                      {commit.hash.slice(0, 7)}{" "}
                      <span className="mx-1 font-sans">•</span>{" "}
                      <span className="font-sans">{formattedDate}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs font-mono font-semibold mt-1 sm:mt-0">
                    <span className="text-emerald-500">+{commit.added}</span>
                    <span className="text-red-500">-{commit.removed}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ←
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`min-w-[2rem] rounded-full px-2 py-1.5 text-xs font-semibold transition ${
                p === page
                  ? "border border-[var(--foreground)] bg-[var(--foreground)] text-[var(--surface)]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            →
          </button>
        </div>
      ) : null}

      {/* Commit Detail Modal */}
      {selectedCommit !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedCommit(null)}>
          <div 
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setSelectedCommit(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--border)] transition text-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <div className="space-y-4 pr-8">
              <div className="flex items-center gap-3 text-sm font-mono text-[var(--muted)] border-b border-[var(--border)] pb-4">
                <span className="font-sans font-medium text-[var(--foreground)]/70">#{selectedCommit.commitNumber}</span>
                <span>•</span>
                <span>{selectedCommit.commit.hash.slice(0, 7)}</span>
                <span>•</span>
                <span className="font-sans">
                  {Number.isNaN(new Date(selectedCommit.commit.date).getTime())
                    ? selectedCommit.commit.date
                    : new Date(selectedCommit.commit.date).toLocaleString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                </span>
                <div className="ml-auto flex items-center gap-3 font-semibold text-xs bg-[var(--background)] px-3 py-1 rounded-md border border-[var(--border)]">
                  <span className="text-emerald-500">+{selectedCommit.commit.added}</span>
                  <span className="text-red-500">-{selectedCommit.commit.removed}</span>
                </div>
              </div>
              
              <div className="text-sm text-[var(--foreground)] whitespace-pre-wrap break-words leading-relaxed font-medium">
                {selectedCommit.commit.message.trim()}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
