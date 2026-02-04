import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole, founderEmail } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await adminClient
    .from("app_users")
    .select("id, email, full_name, role, created_at, tutor_promoted_at");

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load tutors." },
      { status: 500 }
    );
  }

  const tutors = data
    .map((user) => {
      const role = resolveUserRole(user.email, user.role ?? null);
      return {
        id: user.id,
        name: String(user.full_name ?? "").trim() || user.email || "Tutor",
        role,
        email: user.email ?? "",
        promotedAt: user.tutor_promoted_at ?? user.created_at,
      };
    })
    .filter((user) => user.role === "founder" || user.role === "tutor")
    .sort((a, b) => {
      if (a.role === "founder" && b.role !== "founder") {
        return -1;
      }
      if (b.role === "founder" && a.role !== "founder") {
        return 1;
      }
      const promotedA = new Date(a.promotedAt).getTime();
      const promotedB = new Date(b.promotedAt).getTime();
      if (promotedA !== promotedB) {
        return promotedA - promotedB;
      }
      return a.name.localeCompare(b.name);
    })
    .map((user) => user.name);

  if (tutors.length === 0 && founderEmail) {
    return NextResponse.json({ tutors: ["Founder"] });
  }

  return NextResponse.json({ tutors });
}
