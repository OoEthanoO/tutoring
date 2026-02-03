"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentUser, onAuthChange, broadcastAuthChange } from "@/lib/authClient";
import AccountCard from "@/components/AccountCard";

export default function AuthStatusActions() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isMenuOpen]);

  if (isSignedIn === null) {
    return null;
  }

  if (isSignedIn) {
    const onSignOut = async () => {
      setIsSigningOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      broadcastAuthChange();
      setIsSigningOut(false);
      setIsMenuOpen(false);
    };

    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--foreground)]"
        >
          Account
        </button>
        {isMenuOpen ? (
          <div className="absolute right-0 z-30 mt-2 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSigningOut}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--foreground)]"
    >
      Sign in
    </Link>
  );
}

export function AuthStatusLink() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  if (isSignedIn === null || isSignedIn) {
    return null;
  }

  return (
    <Link href="/login" className="transition hover:text-[#1b140f]">
      Login
    </Link>
  );
}

export function AuthStatusCard() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  if (!isSignedIn) {
    return null;
  }

  return <AccountCard />;
}
