"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import AccountCard from "@/components/AccountCard";

export default function AuthStatusActions() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      setIsSignedIn(Boolean(data.user));
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsSignedIn(Boolean(session?.user));
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (isSignedIn === null) {
    return null;
  }

  if (isSignedIn) {
    const onSignOut = async () => {
      setIsSigningOut(true);
      await supabase.auth.signOut();
      setIsSigningOut(false);
    };

    return (
      <button
        type="button"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="rounded border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSigningOut ? "Signing out" : "Sign out"}
      </button>
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
      const { data } = await supabase.auth.getUser();
      setIsSignedIn(Boolean(data.user));
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsSignedIn(Boolean(session?.user));
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
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
      const { data } = await supabase.auth.getUser();
      setIsSignedIn(Boolean(data.user));
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsSignedIn(Boolean(session?.user));
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (!isSignedIn) {
    return null;
  }

  return <AccountCard />;
}
