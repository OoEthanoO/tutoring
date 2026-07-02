"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WeeklyPoint = { week: string; label: string } & Record<string, string | number>;

type AnalyticsData = {
  generatedAt: string;
  totals: {
    verifiedUsers: { total: number; students: number; executives: number };
    courses: { active: number; completed: number; total: number };
    hours: { taught: number; withdrawn: number; classesTaught: number };
    enrollments: { total: number; platform: number; legacy: number };
    raised: number | null;
    attendance: {
      rate: number | null;
      attendedSlots: number;
      enrolledSlots: number;
      trackedClasses: number;
    };
  };
  charts: {
    signupsPerWeek: WeeklyPoint[];
    enrollmentsPerWeek: WeeklyPoint[];
    teachingPerWeek: WeeklyPoint[];
    donationsOverTime: { date: string; amount: number }[];
    attendanceByCourse: {
      courseId: string;
      title: string;
      rate: number;
      attendedSlots: number;
      enrolledSlots: number;
      trackedClasses: number;
    }[];
  };
};

const axisProps = {
  stroke: "var(--muted)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

const tooltipProps = {
  contentStyle: {
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--surface)",
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--foreground)" },
} as const;

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatDonationDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function ChartCard({
  title,
  subtitle,
  children,
  hasData,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  hasData: boolean;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
        {subtitle ? <p className="text-xs text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      <div className="h-64 w-full rounded-xl bg-[var(--surface-muted)] p-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
            Insufficient data for graph
          </div>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsMenu() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/admin/analytics");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to load analytics.");
        return;
      }
      setData((await response.json()) as AnalyticsData);
    };
    load();
  }, []);

  if (error) {
    return (
      <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-red-500">{error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--muted)]">Loading analytics...</p>
      </section>
    );
  }

  const { totals, charts } = data;

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Analytics
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Organization health</h2>
        <p className="text-sm text-[var(--muted)]">
          Org-health metrics for operations and grant reporting.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:grid-cols-3 xl:grid-cols-5">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Verified users
          </p>
          <p className="text-xl font-bold text-[var(--foreground)]">
            {totals.verifiedUsers.total}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {totals.verifiedUsers.students} students · {totals.verifiedUsers.executives} executives
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Courses
          </p>
          <p className="text-xl font-bold text-[var(--foreground)]">{totals.courses.active}</p>
          <p className="text-[10px] text-[var(--muted)]">
            active · {totals.courses.completed} completed · {totals.courses.total} total
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Hours taught
          </p>
          <p className="text-xl font-bold text-[var(--foreground)]">{totals.hours.taught}</p>
          <p className="text-[10px] text-amber-500">
            {totals.hours.withdrawn} withdrawn · {totals.hours.classesTaught} classes
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Total enrollments
          </p>
          <p className="text-xl font-bold text-[var(--foreground)]">
            {totals.enrollments.total.toLocaleString()}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {totals.enrollments.platform} on platform · {totals.enrollments.legacy} pre-website
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
            Total raised
          </p>
          <p className="text-xl font-bold text-emerald-500">
            {totals.raised !== null ? `$${totals.raised.toLocaleString()}` : "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard title="Signups per week" subtitle="Verified accounts" hasData={charts.signupsPerWeek.length > 0}>
          <AreaChart data={charts.signupsPerWeek} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="analyticsSignupsStudents" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="analyticsSignupsExecs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--muted)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--muted)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip {...tooltipProps} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} iconType="plainline" />
            <Area
              type="monotone"
              dataKey="students"
              stroke="var(--foreground)"
              strokeWidth={2}
              fill="url(#analyticsSignupsStudents)"
            />
            <Area
              type="monotone"
              dataKey="executives"
              stroke="var(--muted)"
              strokeWidth={2}
              fill="url(#analyticsSignupsExecs)"
            />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Enrollments per week" hasData={charts.enrollmentsPerWeek.length > 0}>
          <AreaChart
            data={charts.enrollmentsPerWeek}
            margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="analyticsEnrollments" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip {...tooltipProps} />
            <Area
              type="monotone"
              dataKey="enrollments"
              stroke="var(--foreground)"
              strokeWidth={2}
              fill="url(#analyticsEnrollments)"
            />
          </AreaChart>
        </ChartCard>

        <ChartCard
          title="Hours taught per week"
          subtitle="Scheduled classes only — excludes legacy completed courses"
          hasData={charts.teachingPerWeek.length > 0}
        >
          <AreaChart data={charts.teachingPerWeek} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="analyticsHours" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip
              {...tooltipProps}
              formatter={(value, name, item) => {
                if (name === "hours") {
                  const classes = (item?.payload as { classes?: number } | undefined)?.classes ?? 0;
                  return [`${value} hours (${classes} classes)`, "Taught"];
                }
                return [String(value), String(name)];
              }}
            />
            <Area
              type="monotone"
              dataKey="hours"
              stroke="var(--foreground)"
              strokeWidth={2}
              fill="url(#analyticsHours)"
            />
          </AreaChart>
        </ChartCard>

        <ChartCard
          title="Donations over time"
          subtitle="Cumulative amount raised"
          hasData={charts.donationsOverTime.length > 0}
        >
          <AreaChart
            data={charts.donationsOverTime}
            margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="analyticsDonations" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={formatDonationDate} {...axisProps} />
            <YAxis {...axisProps} tickFormatter={(value) => `$${value}`} />
            <Tooltip
              {...tooltipProps}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Raised"]}
              labelFormatter={(label) => formatDonationDate(String(label))}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke="var(--foreground)"
              strokeWidth={2}
              fill="url(#analyticsDonations)"
            />
          </AreaChart>
        </ChartCard>
      </div>

      {charts.attendanceByCourse.length > 0 ? (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Attendance rate by course
              {totals.attendance.rate !== null ? (
                <span className="ml-2 text-[var(--muted)]">
                  · overall {formatPercent(totals.attendance.rate)} ({totals.attendance.attendedSlots}
                  /{totals.attendance.enrolledSlots} across {totals.attendance.trackedClasses}{" "}
                  classes)
                </span>
              ) : null}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Voice-tracked classes only (since Jul 2026); classes with no attendance rows are
              excluded.
            </p>
          </div>
          <div className="h-72 w-full rounded-xl bg-[var(--surface-muted)] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={charts.attendanceByCourse}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={formatPercent}
                  {...axisProps}
                />
                <YAxis type="category" dataKey="title" width={150} {...axisProps} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, _name, item) => {
                    const row = item?.payload as
                      | { attendedSlots?: number; enrolledSlots?: number; trackedClasses?: number }
                      | undefined;
                    return [
                      `${formatPercent(Number(value))} (${row?.attendedSlots ?? 0}/${row?.enrolledSlots ?? 0} across ${row?.trackedClasses ?? 0} classes)`,
                      "Attendance",
                    ];
                  }}
                />
                <Bar dataKey="rate" fill="var(--foreground)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
