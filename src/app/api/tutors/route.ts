import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole, founderEmails, isFounder, isExecutive } from "@/lib/roles";

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
    .select("id, email, full_name, role, created_at, tutor_promoted_at, is_junior, executive_generation");

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load tutors." },
      { status: 500 }
    );
  }

  const { data: coursesData, error: coursesError } = await adminClient
    .from("courses")
    .select("created_by");

  if (coursesError || !coursesData) {
    return NextResponse.json(
      { error: coursesError?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  const activeCreatorIds = new Set(
    coursesData
      .map((c) => c.created_by)
      .filter((id) => typeof id === "string")
  );

  const tutors = data
    .map((user) => {
      const role = resolveUserRole(user.email, user.role ?? null);
      return {
        id: user.id,
        name: String(user.full_name ?? "").trim() || user.email || "Tutor",
        role,
        email: user.email ?? "",
        promotedAt: user.tutor_promoted_at ?? user.created_at,
        isJunior: user.is_junior,
        generation: user.executive_generation ?? null,
      };
    })
    .filter(
      (user) =>
        isExecutive(user.role as any) &&
        (!user.isJunior || activeCreatorIds.has(user.id)) &&
        user.email !== "jingqu2018@gmail.com" &&
        user.email !== "ethanxucoder@gmail.com"
    )
    .sort((a, b) => {
      if (isFounder(a.role as any) && !isFounder(b.role as any)) {
        return -1;
      }
      if (isFounder(b.role as any) && !isFounder(a.role as any)) {
        return 1;
      }
      const promotedA = new Date(a.promotedAt).getTime();
      const promotedB = new Date(b.promotedAt).getTime();
      if (promotedA !== promotedB) {
        return promotedA - promotedB;
      }
      return a.name.localeCompare(b.name);
    })
    .map((user) => ({ id: user.id, name: user.name, generation: user.generation, role: user.role }));

  if (tutors.length === 0 && founderEmails.length > 0) {
    return NextResponse.json({ tutors: [{ name: "Founder", generation: null, role: "founder" }] });
  }

  return NextResponse.json({ tutors });
}
