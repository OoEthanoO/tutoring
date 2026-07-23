import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest, { params }: { params: Promise<{ formId: string }> | { formId: string } }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (role !== "executive" && !isFounder(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { formId } = await params;
  const body = await request.json();
  const { response } = body;

  if (!response) {
    return NextResponse.json({ error: "Response is required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Check deadline
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("deadline")
    .eq("id", formId)
    .single();

  if (formError || !form) {
    return NextResponse.json({ error: "Form not found." }, { status: 404 });
  }

  if (form.deadline && new Date() > new Date(form.deadline)) {
    return NextResponse.json({ error: "The deadline for this form has passed." }, { status: 403 });
  }

  const { error } = await supabase
    .from("form_responses")
    .upsert({
      form_id: formId,
      user_id: user.id,
      response,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "form_id,user_id"
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ formId: string }> | { formId: string } }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (role !== "executive" && !isFounder(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { formId } = await params;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Check deadline
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("deadline")
    .eq("id", formId)
    .single();

  if (formError || !form) {
    return NextResponse.json({ error: "Form not found." }, { status: 404 });
  }

  if (form.deadline && new Date() > new Date(form.deadline)) {
    return NextResponse.json({ error: "The deadline for this form has passed." }, { status: 403 });
  }

  const { error } = await supabase
    .from("form_responses")
    .delete()
    .eq("form_id", formId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
