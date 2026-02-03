"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";

export default function PublicHome() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  if (isSignedIn || isSignedIn === null) {
    return null;
  }

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
          Ethan&apos;s Coding Classroom
        </h2>
      </header>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          About the Program
        </h3>
        <p className="text-sm text-[var(--muted)]">
          Ethan&apos;s Coding Classroom is a free coding tutoring program. This
          program was launched in July 2023 and is aimed at students in grades
          6-12. The courses are taught online and provides a series of different
          languages, mainly including Java, C++, and Python.
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
          About the Tutor
        </h3>
        <p className="text-sm text-[var(--muted)]">
          Ethan Xu, Toronto Highschooler, programming and computer science
          enthusiast, 6 years of coding experience, fluent in Java, C++, and
          Python. Exam score of 5 on AP Computer Science Applied and excellent
          results in CCC. As of December 2025, more than 270 classes have been
          taught and more than 230 people have participated in the program.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Donate to SickKids Today
        </h3>
        <a
          href="https://give.sickkidsfoundation.com/fundraisers/codingforsickkids"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold text-[var(--foreground)] underline"
        >
          https://give.sickkidsfoundation.com/fundraisers/codingforsickkids
        </a>
      </div>
    </section>
  );
}
