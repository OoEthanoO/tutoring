"use client";

/**
 * The running list of courses nobody teaches yet, as shown in two places: the
 * founder trio's Admin Tools panel (where the rows can be removed) and Course
 * requests (where every executive sees what is open and can offer to teach it).
 *
 * Presentational only — each parent owns the fetching, so the two panels can
 * disagree about layout without disagreeing about what a need looks like.
 */

export type CourseNeed = {
  id: string;
  need: string;
  created_at: string;
  /** Null when the Discord announcement never went out. */
  announced_at: string | null;
  added_by: string | null;
};

const addedOn = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

type CourseNeedsListProps = {
  needs: CourseNeed[];
  /** Founder trio only: crossing a course off once someone takes it on. */
  onRemove?: (need: CourseNeed) => void;
  /** Executives: start a course request already titled with this course. */
  onRequest?: (need: CourseNeed) => void;
  /** Id of the row with an action in flight, so its buttons can be disabled. */
  busyId?: string | null;
  emptyMessage?: string;
};

export default function CourseNeedsList({
  needs,
  onRemove,
  onRequest,
  busyId = null,
  emptyMessage = "Nothing on the list — every course we offer has a tutor.",
}: CourseNeedsListProps) {
  if (needs.length === 0) {
    return <p className="text-xs text-[var(--muted)]">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {needs.map((need) => (
        <li
          key={need.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{need.need}</p>
            <p className="text-xs text-[var(--muted)]">
              {[need.added_by ? `Added by ${need.added_by}` : "Added", addedOn(need.created_at)]
                .filter(Boolean)
                .join(" · ")}
              {need.announced_at ? null : (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Not announced in Discord
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onRequest ? (
              <button
                type="button"
                onClick={() => onRequest(need)}
                className="rounded-full border border-[var(--foreground)] px-3 py-1 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
              >
                I can teach this
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(need)}
                disabled={busyId === need.id}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === need.id ? "Removing..." : "Remove"}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
