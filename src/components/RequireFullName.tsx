"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type GateState = "loading" | "ready";

export default function RequireFullName({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    const checkProfile = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace("/login");
        return;
      }

      const fullName = data.user.user_metadata?.full_name;
      if (!fullName || String(fullName).trim().length === 0) {
        router.replace("/onboarding");
        return;
      }

      setState("ready");
    };

    checkProfile();
  }, [router]);

  if (state === "loading") {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-20 text-sm text-[#6b5a4d]">
        Checking your profile...
      </div>
    );
  }

  return <>{children}</>;
}
