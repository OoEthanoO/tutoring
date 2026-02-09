"use client";

import { useEffect } from "react";
import { iteration } from "@/lib/iteration";

export default function Footer() {
  useEffect(() => {
    const checkIteration = async () => {
      try {
        const response = await fetch(
          `/api/iteration?ts=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { iteration?: string };
        const serverIteration = data.iteration ?? iteration;
        if (serverIteration !== iteration) {
          window.location.reload();
        }
      } catch {
        // Ignore iteration check errors.
      }
    };

    checkIteration();
    const interval = window.setInterval(checkIteration, 15000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <footer className="mt-auto border-t border-[var(--border)] pt-6 text-center text-xs text-[var(--muted)]">
      <p>
        Made with ❤️ by Ethan Yan Xu | Iteration{" "}
        {iteration}
      </p>
    </footer>
  );
}
