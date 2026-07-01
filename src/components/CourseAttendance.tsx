"use client";

import { useEffect, useState } from "react";

type RosterEntry = {
  userId: string;
  name: string;
  isTutor: boolean;
  present: boolean;
  firstSeenAt: string | null;
  hasDiscord: boolean;
};

type AttendanceClass = {
  classId: string;
  title: string;
  startsAt: string;
  durationHours: number;
  started: boolean;
  roster: RosterEntry[];
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/**
 * Attendance roster for a course — one block per class showing who attended,
 * driven by /api/courses/[courseId]/attendance. Used by tutors (their own
 * courses) and admins. Auto-attendance comes from Discord voice presence.
 */
export default function CourseAttendance({ courseId }: { courseId: string }) {
  const [classes, setClasses] = useState<AttendanceClass[] | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError("");
      const response = await fetch(`/api/courses/${courseId}/attendance`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!cancelled) {
          setError(payload?.error ?? "Could not load attendance.");
          setIsLoading(false);
        }
        return;
      }
      const data = (await response.json()) as { classes?: AttendanceClass[] };
      if (!cancelled) {
        setClasses(data.classes ?? []);
        setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (isLoading) {
    return <p className="text-xs text-[var(--muted)]">Loading attendance...</p>;
  }
  if (error) {
    return <p className="text-xs text-red-500">{error}</p>;
  }
  if (!classes || classes.length === 0) {
    return <p className="text-xs text-[var(--muted)]">No classes yet.</p>;
  }

  return (
    <div className="space-y-3">
      {classes.map((cls) => {
        const started = cls.started;
        const students = cls.roster.filter((r) => !r.isTutor);
        const presentStudents = students.filter((r) => r.present).length;
        return (
          <div key={cls.classId} className="rounded-lg border border-[var(--border)] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--foreground)]">
                {cls.title || "Class"}{" "}
                <span className="font-normal text-[var(--muted)]">· {formatDate(cls.startsAt)}</span>
              </p>
              {started ? (
                <span className="text-[11px] font-semibold text-[var(--foreground)]">
                  {presentStudents}/{students.length} students
                </span>
              ) : (
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Upcoming
                </span>
              )}
            </div>
            {started ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cls.roster.map((entry) => {
                  const label = `${entry.name}${entry.isTutor ? " (tutor)" : ""}`;
                  if (entry.present) {
                    return (
                      <span
                        key={entry.userId}
                        className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-500"
                        title={entry.firstSeenAt ? `Joined ${formatDate(entry.firstSeenAt)}` : undefined}
                      >
                        ✓ {label}
                      </span>
                    );
                  }
                  if (!entry.hasDiscord) {
                    return (
                      <span
                        key={entry.userId}
                        className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]"
                        title="No Discord linked — attendance can't be auto-tracked"
                      >
                        ? {label} · no Discord
                      </span>
                    );
                  }
                  return (
                    <span
                      key={entry.userId}
                      className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-500"
                    >
                      ✗ {label}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
