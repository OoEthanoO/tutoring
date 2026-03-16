"use client";

interface EventReminderBannerProps {
  onAction: () => void;
}

export default function EventReminderBanner({ onAction }: EventReminderBannerProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 p-4 transition-all hover:bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20 dark:hover:bg-amber-950/30">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-400">
              Pending Event Invitations
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-500/80">
              You haven't selected your availability for all upcoming event dates.
            </p>
          </div>
        </div>
        <button
          onClick={onAction}
          className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-amber-700 active:scale-[0.98] dark:bg-amber-700 dark:hover:bg-amber-600"
        >
          View Events
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
      
      {/* Subtle shimmer effect */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}
