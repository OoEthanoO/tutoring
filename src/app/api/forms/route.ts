import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  const isExecutive = role === "founder" || role === "executive";

  if (!isExecutive) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const isFounder = role === "founder";

  const { data: forms, error } = await supabase
    .from("forms")
    .select(`
      *,
      form_responses (*)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let filteredForms = forms || [];

  if (isFounder && filteredForms) {
    const responseUserIds = Array.from(new Set(
      filteredForms.flatMap(f => f.form_responses.map((r: any) => r.user_id))
    ));

    const { data: allUsers } = await supabase
      .from("app_users")
      .select("id, full_name, email, is_junior, role")
      .in("role", ["executive", "tutor", "founder"]);

    const userMap = new Map(allUsers?.map(u => [u.id, u]) ?? []);

    filteredForms.forEach(form => {
      form.form_responses.forEach((resp: any) => {
        resp.user = userMap.get(resp.user_id);
      });

      form.all_executives = (allUsers || []).filter(u =>
        resolveUserRole(u.email, u.role) === "executive"
      );
    });
  } else {
    // For executives, only return their own responses
    filteredForms.forEach(form => {
      form.form_responses = form.form_responses.filter((r: any) => r.user_id === user.id);
    });
  }

  return NextResponse.json({ forms: filteredForms });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (resolveUserRole(user.email, user.role ?? null) !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, options, deadline } = body;

  if (!title || !options || !Array.isArray(options) || options.length === 0 || !deadline) {
    return NextResponse.json({ error: "Title, options, and deadline are required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: form, error } = await supabase
    .from("forms")
    .insert({
      title,
      description,
      options,
      deadline,
      created_by: user.id
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ form });
}
