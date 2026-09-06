"use client";

import { useEffect, useState } from "react";

type HomeMenuProps = {
  isSignedIn: boolean;
  onOpenTeamTab: () => void;
};

export default function HomeMenu({ isSignedIn, onOpenTeamTab }: HomeMenuProps) {
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [raised, setRaised] = useState<number | null>(null);

  useEffect(() => {
    const loadTeamCount = async () => {
      const response = await fetch("/api/team/count");
      if (!response.ok) {
        setTeamCount(null);
        return;
      }
      const data = (await response.json()) as { count?: number | null };
      setTeamCount(typeof data.count === "number" ? data.count : null);
    };

    loadTeamCount();
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
          All YanLearn tutors are current IB/AP high school students with excellent grades in their respective subjects. We run our classes by hosting online Discord meetings with a requirement of a donation fee to enjoy 10 lessons per term. As of September 2026, more than 597 hours have been taught, and more than 459 enrollments in our program.
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
      {teamCount !== null ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Team Count
          </h3>
          <p className="text-sm text-[var(--muted)]">
            We have {teamCount} dedicated team members across different roles and generations. Open the <button type="button" onClick={onOpenTeamTab} className="underline hover:text-[var(--foreground)] transition-colors">Our team</button> tab to meet everyone.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Letter of Support
        </h3>
        <p className="text-sm text-[var(--muted)]">
          You can view our Letter of Support from SickKids Foundation below.
        </p>
        <div className="mt-4 w-full h-[600px] rounded border border-[var(--border)] overflow-hidden">
          <object
            data="/Letter%20of%20Support%20from%20SickKids%20Foundation.pdf"
            type="application/pdf"
            width="100%"
            height="100%"
            className="w-full h-full"
          >
            <embed
              src="/Letter%20of%20Support%20from%20SickKids%20Foundation.pdf"
              type="application/pdf"
              width="100%"
              height="100%"
              className="w-full h-full"
            />
          </object>
        </div>
      </div>
    </section>
  );
}
