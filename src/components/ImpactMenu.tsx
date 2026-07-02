"use client";

import { useEffect, useState } from "react";

type ImpactData = {
  generatedAt: string;
  hoursTaught: number;
  classesTaught: number;
  courses: { total: number; completed: number };
  enrollments: number;
  students: number;
  tutors: number;
  raised: number | null;
};

function ImpactTile({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-6">
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
          accent ? "text-emerald-500" : "text-[var(--muted)]"
        }`}
      >
        {label}
      </p>
      <p
        className={`text-3xl font-bold ${
          accent ? "text-emerald-500" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </p>
      {detail ? <p className="text-xs text-[var(--muted)]">{detail}</p> : null}
    </div>
  );
}

/**
 * Public, sponsor-facing impact page. Numbers come from /api/impact, which
 * shares its computation with the founder analytics dashboard.
 */
export default function ImpactMenu() {
  const [data, setData] = useState<ImpactData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/impact");
      if (!response.ok) {
        setError("Unable to load impact stats right now. Please try again later.");
        return;
      }
      setData((await response.json()) as ImpactData);
    };
    load();
  }, []);

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Impact
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Our impact, in numbers
        </h2>
        <p className="text-sm text-[var(--muted)]">
          YanLearn is a youth-led nonprofit providing free peer tutoring. These numbers update
          automatically as our programs run.
        </p>
      </header>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {!error && !data ? (
        <p className="text-sm text-[var(--muted)]">Loading impact stats...</p>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <ImpactTile
              label="Hours of free tutoring"
              value={Math.round(data.hoursTaught).toLocaleString()}
              detail={`across ${data.classesTaught.toLocaleString()} classes`}
            />
            <ImpactTile
              label="Student enrollments"
              value={data.enrollments.toLocaleString()}
              detail="every course seat filled, including pre-platform programs"
            />
            <ImpactTile
              label="Courses run"
              value={data.courses.total.toLocaleString()}
              detail={`${data.courses.completed.toLocaleString()} completed`}
            />
            <ImpactTile
              label="Students on the platform"
              value={data.students.toLocaleString()}
            />
            <ImpactTile
              label="Volunteer tutors"
              value={data.tutors.toLocaleString()}
            />
            <ImpactTile
              label="Raised for charity"
              value={data.raised !== null ? `$${data.raised.toLocaleString()}` : "—"}
              detail="Coding for SickKids campaign"
              accent
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            Includes programs run before this platform launched. Figures refresh hourly.
          </p>
        </>
      ) : null}
    </section>
  );
}
