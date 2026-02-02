"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function AuthStatusActions() {
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

  if (isSignedIn === null) {
    return null;
  }

  if (isSignedIn) {
    return null;
  }

  return (
    <Link
      href="/login"
      className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
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
