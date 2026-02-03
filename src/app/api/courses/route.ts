import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const response = NextResponse.next();
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value;
      },
      set(name, value, options) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name, options) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.user_metadata?.role ?? null);
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        description?: string;
        classes?: { title?: string; startsAt?: string }[];
      }
    | null;

  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const classes = Array.isArray(body?.classes) ? body?.classes ?? [] : [];
  const creatorName =
    String(user.user_metadata?.full_name ?? "").trim() ||
    user.email ||
    "Unknown tutor";

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error: insertError } = await adminClient
    .from("courses")
    .insert({
      title,
      description,
      created_by: user.id,
      created_by_name: creatorName,
      created_by_email: user.email ?? null,
    })
    .select(
      "id, title, description, created_by, created_by_name, created_by_email, created_at"
    )
    .single();

  if (insertError || !data) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create course." },
      { status: 500 }
    );
  }

  let createdClasses:
    | { id: string; title: string; starts_at: string; created_at: string }[]
    | null = null;

  const classRows = classes
    .map((item) => ({
      title: item?.title?.trim() ?? "",
      startsAt: item?.startsAt?.trim() ?? "",
    }))
    .filter((item) => item.title && item.startsAt);

  if (classRows.length > 0) {
    const { data: classData, error: classError } = await adminClient
      .from("course_classes")
      .insert(
        classRows.map((item) => ({
          course_id: data.id,
          title: item.title,
          starts_at: item.startsAt,
          created_by: user.id,
        }))
      )
      .select("id, title, starts_at, created_at");

    if (classError || !classData) {
      return NextResponse.json(
        { error: classError?.message ?? "Failed to add classes." },
        { status: 500 }
      );
    }

    createdClasses = classData;
  }

  return NextResponse.json({
    course: {
      ...data,
      course_classes: createdClasses ?? [],
    },
  });
}

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const response = NextResponse.next();
  const authClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value;
      },
      set(name, value, options) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name, options) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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

  let query = adminClient
    .from("courses")
    .select(
      "id, title, description, created_by, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, created_at)"
    )
    .order("created_at", { ascending: false })
    .order("starts_at", { foreignTable: "course_classes", ascending: true });

  const { data, error: listError } = await query;

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  return NextResponse.json({ courses: data });
}
