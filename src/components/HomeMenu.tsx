"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { isFounder, resolveUserRole } from "@/lib/roles";

type HomeMenuProps = {
  isSignedIn: boolean;
  onOpenTeamTab: () => void;
};

export default function HomeMenu({ isSignedIn, onOpenTeamTab }: HomeMenuProps) {
  const [tutors, setTutors] = useState<{ name: string; generation: string | null; role: string }[]>([]);
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [raised, setRaised] = useState<number | null>(null);

  useEffect(() => {
    const loadTeamCount = async () => {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        setTeamCount(null);
        return;
      }

      const customRoleLevels = Array.isArray(currentUser.custom_roles)
        ? currentUser.custom_roles.map((r: any) => r.role_level).filter(Boolean)
        : [currentUser.custom_roles?.role_level].filter(Boolean);
      const resolvedRole = resolveUserRole(currentUser.email, currentUser.role ?? null, customRoleLevels);

      if (!isFounder(resolvedRole)) {
        setTeamCount(null);
        return;
      }

      const response = await fetch("/api/admin/users?all=true");
      if (!response.ok) {
        setTeamCount(null);
        return;
      }

      const data = (await response.json()) as { users?: Array<{ email?: string; customRole?: string | null; role?: string }> };
      const count = (data.users ?? []).filter((user) => {
        const role = String(user.customRole ?? user.role ?? "").trim();
        return ["founder", "CEO", "COO", "Chief Executive", "Executive", "executive", "Junior Executive"].includes(role);
      }).length;

      setTeamCount(count);
    };

    loadTeamCount();

    return onAuthChange(loadTeamCount);
  }, []);

  useEffect(() => {
    const loadTutors = async () => {
      const response = await fetch("/api/tutors");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { tutors?: { name: string; generation: string | null; role: string }[] };
      setTutors(data.tutors ?? []);
    };

    loadTutors();
  }, []);

  useEffect(() => {
    const loadRaised = async () => {
      const response = await fetch("/api/fundraising/total");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { raised?: number | null };
      setRaised(typeof data.raised === "number" ? data.raised : null);
    };

    loadRaised();
  }, []);

  return (
    <section
      id="home"
      className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Home
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          YanLearn
        </h2>
      </header>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          About the Program
        </h3>
        <p className="text-sm text-[var(--muted)]">
          YanLearn is a free online tutoring platform. Originally launched in
          July 2023 as Ethan&apos;s Coding Classroom, it has expanded to include
          multiple passionate tutors teaching a variety of subjects to students
          in grades 6-12.
        </p>
        <p className="text-sm text-[var(--muted)]">
          All YanLearn tutors are current IB/AP high school students with
          excellent grades in their respective subjects. We run our classes by
          hosting online Zoom meetings with a requirement of a $50 donation fee
          to enjoy 10 lessons per term. As of February 2026, more than 290 classes
          have been taught, and more than 260 students are participating in our
          program.
        </p>
        <p className="text-sm text-[var(--muted)]">
          In addition, the &quot;Coding for SickKids&quot; fundraising campaign
          initiated by Yan is operated by the SickKids Fundraising platform,
          where any donations are paid directly to hospitals.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Our Team
        </h3>
        <p className="text-sm text-[var(--muted)]">
          YanLearn was founded by passionate high school students dedicated to making quality education accessible to everyone. Our team includes talented tutors and executives across various subjects and skill levels. Open the <button type="button" onClick={onOpenTeamTab} className="underline hover:text-[var(--foreground)] transition-colors">Our team</button> tab to meet the full roster and read the mission.
        </p>
      </div>
      {raised !== null ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {!isSignedIn ? (
            <>
              <a
                href="https://give.sickkidsfoundation.com/fundraisers/codingforsickkids/ethan--s-coding-class"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Coding for SickKids
              </a>{" "}
              has raised ${raised.toLocaleString()}
            </>
          ) : (
            <>Coding for SickKids has raised ${raised.toLocaleString()}</>
          )}
        </p>
      ) : null}
      {teamCount !== null || tutors.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Team Count
          </h3>
          <p className="text-sm text-[var(--muted)]">
            We have {teamCount ?? tutors.length} dedicated team members across different roles and generations. Open the <button type="button" onClick={onOpenTeamTab} className="underline hover:text-[var(--foreground)] transition-colors">Our team</button> tab to meet everyone.
          </p>
        </div>
      ) : null}
    </section>
  );
}
