import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
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
          "Mozilla/5.0 (compatible; EthanCodingClassBot/1.0; +https://class.ethanyanxu.com)",
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

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
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
  if (role !== "tutor") {
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
    .select("donation_link")
    .eq("user_id", user.id)
    .maybeSingle();

  const donationLink = data?.donation_link ?? "";
  if (!donationLink) {
    return NextResponse.json({
      donationLink: "",
      donationProgress: { raised: null },
    });
  }

  const donationProgress = await fetchDonationProgress(donationLink);
  return NextResponse.json({ donationLink, donationProgress });
}
