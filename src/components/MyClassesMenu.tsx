"use client";

import React, { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";

type StatusState = {
  type: "idle" | "error";
  message: string;
};

type UpcomingClass = {
  id: string;
  course_id: string;
  course_title: string;
  class_title: string;
  starts_at: string;
  duration_hours: number;
  role_in_course: "student" | "tutor" | "founder";
  tutor_name?: string | null;
  students?: Array<{ name: string | null; email: string | null }>;
};

const formatTimeRange = (startsAt: string, durationHours: number) => {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  
  const startTimeStr = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  
  const endTimeStr = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${dateStr} • ${startTimeStr} - ${endTimeStr}`;
};

const isOngoingClass = (startsAt: string, durationHours: number, nowMs: number) => {
  const start = new Date(startsAt).getTime();
  const end = start + durationHours * 60 * 60 * 1000;
  return nowMs >= start && nowMs <= end;
};

export default function MyClassesMenu() {
  const [userId, setUserId] = useState<string | null>(null);
  const [classes, setClasses] = useState<UpcomingClass[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pastAttendance, setPastAttendance] = useState<
    { classId: string; courseTitle: string; classTitle: string; startsAt: string; attended: boolean }[]
  >([]);
  const [attendanceHasDiscord, setAttendanceHasDiscord] = useState(true);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setUserId(user?.id ?? null);
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!userId) {
      setClasses([]);
      return;
    }

    const loadClasses = async () => {
      setIsLoading(true);
      const response = await fetch("/api/my-classes");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to load upcoming classes.",
        });
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as { classes: UpcomingClass[] };
      setClasses(data.classes ?? []);
      setIsLoading(false);
    };

    loadClasses();
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setPastAttendance([]);
      return;
    }
    const loadAttendance = async () => {
      const response = await fetch("/api/my-attendance");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        hasDiscord?: boolean;
        classes?: { classId: string; courseTitle: string; classTitle: string; startsAt: string; attended: boolean }[];
      };
      setAttendanceHasDiscord(data.hasDiscord ?? true);
      setPastAttendance(data.classes ?? []);
    };
    loadAttendance();
  }, [userId]);

  if (!userId) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Classes
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            My classes
          </h2>
        </div>
        {!isLoading && classes.length > 0 ? (
          <div className="flex items-center justify-center rounded-full bg-[var(--foreground)]/5 px-3 py-1 text-xs font-medium text-[var(--foreground)]">
            {classes.length} {classes.length === 1 ? "class" : "classes"} left
          </div>
        ) : null}
      </header>

      {status.type === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {status.message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading classes...</p>
      ) : null}

      {!isLoading && classes.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          You have no upcoming classes.
        </p>
      ) : null}

      <div className="space-y-3">
        {classes.map((cls) => {
          const ongoing = isOngoingClass(cls.starts_at, cls.duration_hours, nowMs);
          return (
            <div
              key={`${cls.course_id}-${cls.id}`}
              className={`flex flex-col gap-2 rounded-xl border px-5 py-4 transition-colors hover:border-[var(--foreground)]/20 ${
                ongoing ? "border-amber-400 animate-pulse" : "border-[var(--border)]"
              }`}
            >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {cls.course_title}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {cls.class_title} <span className="mx-1">•</span> Tutor: {cls.tutor_name || "Unknown"}
                </p>
              </div>
              <div className="flex w-full flex-col sm:w-auto sm:items-end text-left sm:text-right">
                <p className="text-xs font-medium text-[var(--foreground)] self-start sm:self-auto">
                  {formatTimeRange(cls.starts_at, cls.duration_hours)}
                </p>
                <div className="mt-1 text-xs text-[var(--muted)] w-full text-right sm:w-auto">
                  {cls.role_in_course === "student"
                    ? "Student"
                    : cls.role_in_course === "tutor"
                      ? "Tutor"
                      : "Founder"}
                </div>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {pastAttendance.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Past attendance
          </p>
          {!attendanceHasDiscord ? (
            <p className="text-xs text-amber-600">
              Connect and join Discord so your class attendance can be tracked automatically.
            </p>
          ) : null}
          <div className="space-y-2">
            {pastAttendance.slice(0, 12).map((cls) => (
              <div
                key={cls.classId}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">{cls.courseTitle}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {cls.classTitle} <span className="mx-1">•</span>{" "}
                    {new Date(cls.startsAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                {cls.attended ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
                    Attended
                  </span>
                ) : (
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-500">
                    Absent
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
