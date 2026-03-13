"use client";

import { useEffect, useState } from "react";

type HomeMenuProps = {
  isSignedIn: boolean;
};

export default function HomeMenu({ isSignedIn }: HomeMenuProps) {
  const [tutors, setTutors] = useState<string[]>([]);
  const [raised, setRaised] = useState<number | null>(null);

  useEffect(() => {
    const loadTutors = async () => {
      const response = await fetch("/api/tutors");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { tutors?: string[] };
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
          to enjoy 10 lessons per term. As of March 2026, more than 290 classes
          have been taught, and more than 260 students are participating in our
          program.
        </p>
        <p className="text-sm text-[var(--muted)]">
          In addition, the &quot;Coding for SickKids&quot; fundraising campaign
          initiated by Ethan is operated by the SickKids Fundraising platform,
          where any donations are paid directly to hospitals.
        </p>
        <p className="text-sm text-[var(--muted)]">
          Our Fundraising Website:{" "}
          <a
            href="https://give.sickkidsfoundation.com/fundraisers/codingforsickkids"
            target="_blank"
            rel="noreferrer"
            className="underline transition-colors hover:text-[var(--foreground)]"
          >
            give.sickkidsfoundation.com/fundraisers/codingforsickkids
          </a>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          About the Founder
        </h3>
        <p className="text-sm text-[var(--muted)]">
          Ethan Yan Xu, IB program, G11, programming and computer science
          enthusiast, 7 years of coding experience, fluent in Java, C++, and
          Python. He has been a programming instructor for three years.
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
      {tutors.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Our Team
          </h3>
          <div className="flex flex-wrap gap-2 transition-all duration-300">
            {tutors.map((name, index) => {
              const displayName = name.replace(/\bExecutive\b/gi, "EXEC");
              return (
                <span
                  key={`${name}-${index}`}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-medium text-[var(--muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {displayName}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
