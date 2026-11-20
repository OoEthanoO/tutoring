import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { normalizePaymentNote, paymentNoteClearBlocker } from "@/lib/paidCourses";
import { countActivePaidCourses } from "@/lib/paidCoursesServer";
import { isAllowedRequestOrigin } from "@/lib/requestOrigin";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const donationHost = "give.sickkidsfoundation.com";

const parseDollarAmount = (value: string) => {
  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
};

const findAmountAfterLabel = (html: string, labelPattern: RegExp) => {
  const match = html.match(labelPattern);
  if (!match || !match[1]) {
    return null;
  }
  return parseDollarAmount(match[1]);
};

const fetchDonationProgress = async (donationLink: string) => {
  try {
    const url = new URL(donationLink);
    if (url.hostname !== donationHost) {
      return { raised: null };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(donationLink, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; YanLearnBot/1.0; +https://class.ethanyanxu.com)",
      },
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { raised: null };
    }

    const html = await response.text();
    const raised =
      findAmountAfterLabel(
        html,
        /Raised[\s\S]{0,140}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
      ) ??
      findAmountAfterLabel(
        html,
        /Please Help Me Reach My Goal[\s\S]{0,220}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)[\s\S]{0,120}?My Goal/i
      );

    return { raised };
  } catch {
    return { raised: null };
  }
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (role !== "executive" && !isFounder(role)) {
    return NextResponse.json({ donationLink: "" });
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

  const { data } = await adminClient
    .from("tutor_profiles")
    .select("donation_link, payment_note")
    .eq("user_id", user.id)
    .maybeSingle();

  // Senior tutors may teach paid courses and keep a payment note for them
  // (PAID_COURSES.md).
  const { data: standing } = await adminClient
    .from("app_users")
    .select("senior_tutor")
    .eq("id", user.id)
    .maybeSingle();
  const paid = {
    seniorTutor: Boolean(standing?.senior_tutor),
    paymentNote: data?.payment_note ?? "",
  };

  // Find completed courses for this user (not deleted)
  const { data: completedCourses } = await adminClient
    .from("courses")
    .select("completed_class_count")
    .eq("created_by", user.id)
    .is("deleted_at", null)
    .eq("is_completed", true);

  const completedClasses = (completedCourses ?? []).reduce((acc, course) => {
    const count = typeof course.completed_class_count === 'number' 
      ? course.completed_class_count 
      : Number(course.completed_class_count || 0);
    return acc + (Number.isNaN(count) ? 0 : count);
  }, 0);
  
  let taughtMinutes = completedClasses * 60;

  const nowStr = new Date().toISOString();
  
  // Find past classes. We use the foreign key to match courses created_by, 
  // ensuring we also skip deleted courses and old classes missing `created_by` get correctly counted.
  const { data: pastClasses } = await adminClient
    .from("course_classes")
    .select("duration_hours, courses!inner(created_by, deleted_at)")
    .eq("courses.created_by", user.id)
    .is("courses.deleted_at", null)
    .lt("starts_at", nowStr);

  const pastClassHours = (pastClasses ?? []).reduce((acc, cls) => {
    const hours = typeof cls.duration_hours === 'number' 
      ? cls.duration_hours 
      : Number.parseFloat(String(cls.duration_hours || 1));
    return acc + (Number.isNaN(hours) ? 1 : hours);
  }, 0);
  
  taughtMinutes += Math.round(pastClassHours * 60);

  const donationLink = data?.donation_link ?? "";
  if (!donationLink) {
    return NextResponse.json({
      donationLink: "",
      donationProgress: { raised: null },
      taughtMinutes,
      ...paid,
    });
  }

  const donationProgress = await fetchDonationProgress(donationLink);
  return NextResponse.json({ donationLink, donationProgress, taughtMinutes, ...paid });
}

/**
 * A senior tutor sets the payment note families see on their paid courses.
 * Management edits anyone's in Admin > Manage accounts instead.
 */
export async function PATCH(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { paymentNote?: unknown } | null;
  if (!body || body.paymentNote === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const parsedNote = normalizePaymentNote(body.paymentNote);
  if (!parsedNote.ok) {
    return NextResponse.json({ error: parsedNote.error }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: standing, error: standingError } = await adminClient
    .from("app_users")
    .select("senior_tutor")
    .eq("id", user.id)
    .maybeSingle();
  if (standingError) {
    return NextResponse.json({ error: "Could not check your tutor standing." }, { status: 503 });
  }
  if (!standing?.senior_tutor) {
    return NextResponse.json(
      { error: "Only senior tutors have a payment note." },
      { status: 403 }
    );
  }

  if (parsedNote.note === null) {
    let activePaidCourses: number;
    try {
      activePaidCourses = await countActivePaidCourses(adminClient, user.id);
    } catch {
      return NextResponse.json({ error: "Could not check your paid courses." }, { status: 503 });
    }
    const blocker = paymentNoteClearBlocker(activePaidCourses);
    if (blocker) {
      return NextResponse.json({ error: blocker }, { status: 400 });
    }
  }

  const { error: saveError } = await adminClient.from("tutor_profiles").upsert({
    user_id: user.id,
    payment_note: parsedNote.note,
    updated_at: new Date().toISOString(),
  });
  if (saveError) {
    return NextResponse.json({ error: "Could not save the payment note." }, { status: 500 });
  }

  return NextResponse.json({ paymentNote: parsedNote.note ?? "" });
}
