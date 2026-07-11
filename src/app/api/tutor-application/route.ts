import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { ensureTutorApplicationsSchema } from "./status/route";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      fullName,
      email,
      phoneNumber,
      currentGrade,
      parentsPhoneNumber,
      subjectGrades,
      programmingProficiency,
      debateExperience,
      otherCoursesExperience,
      consentSignature,
    } = body;

    // Validate all required fields
    if (!fullName?.trim()) {
      return NextResponse.json({ error: "Legal Full Name is required." }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!phoneNumber?.trim()) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    }
    if (!currentGrade?.trim()) {
      return NextResponse.json({ error: "Current grade is required." }, { status: 400 });
    }
    if (!parentsPhoneNumber?.trim()) {
      return NextResponse.json({ error: "Parents' phone number is required." }, { status: 400 });
    }
    if (!consentSignature?.trim()) {
      return NextResponse.json({ error: "Consent signature is required." }, { status: 400 });
    }

    const allowedGrades = ["Grade 9", "Grade 10", "Grade 11", "Grade 12"];
    if (!allowedGrades.includes(currentGrade)) {
      return NextResponse.json(
        { error: "Grade must be Grade 9, Grade 10, Grade 11, or Grade 12." },
        { status: 400 }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Ensure the schema is created
    await ensureTutorApplicationsSchema(adminClient);

    // Save/Insert the tutor application
    const { error: insertError } = await adminClient
      .from("tutor_applications")
      .upsert(
        {
          user_id: user.id,
          full_name: fullName.trim(),
          email: email.trim(),
          phone_number: phoneNumber.trim(),
          current_grade: currentGrade,
          parents_phone_number: parentsPhoneNumber.trim(),
          subject_grades: subjectGrades?.trim() || null,
          programming_proficiency: programmingProficiency?.trim() || null,
          debate_experience: debateExperience?.trim() || null,
          other_courses_experience: otherCoursesExperience?.trim() || null,
          consent_signature: consentSignature.trim(),
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (insertError) {
      return NextResponse.json(
        { error: `Database save failed: ${insertError.message}` },
        { status: 500 }
      );
    }

    // Automatically sync legal_name and grade to the user profile
    const { error: userUpdateError } = await adminClient
      .from("app_users")
      .update({
        legal_name: fullName.trim(),
        grade: currentGrade,
      })
      .eq("id", user.id);

    if (userUpdateError) {
      console.error("Failed to sync legal_name and grade to app_users:", userUpdateError);
      // We don't fail the whole request because the application was saved, but we log the error.
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
