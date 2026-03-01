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
          YanLearn is a free online tutoring platform. Originally launched in July
          2023 as Ethan&apos;s Coding Classroom, it has expanded to include multiple
          passionate tutors teaching a variety of subjects to students in grades
          6-12.
        </p>
        <p className="text-sm text-[var(--muted)]">
          In addition, The &quot;Coding for SickKids&quot; fundraising campaign
          initiated by Ethan is operated by the SickKids Fundraise platform
          where any donations are paid directly to hospitals. Everyone is
          welcomed to donate to help sick kids in need.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          About the Founder
        </h3>
        <p className="text-sm text-[var(--muted)]">
          Ethan Yan Xu, Toronto Highschooler, programming and computer science
          enthusiast, 6 years of coding experience, fluent in Java, C++, and
          Python. Exam score of 5 on AP Computer Science Applied and excellent
          results in CCC. As of January 2026, more than 280 classes have been
          taught and more than 230 people have participated in the program.
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
            Our Tutors
          </h3>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            {tutors.map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
