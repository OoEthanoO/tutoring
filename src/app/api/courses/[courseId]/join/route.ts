import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { registerZoomParticipant } from "@/lib/zoom";
import { jwtDecode } from "jwt-decode";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface JwtPayload {
  sub: string;
}

/**
 * Verify auth token and get user ID
 */
function getUserIdFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwtDecode<JwtPayload>(token);
    return decoded.sub;
  } catch {
    return null;
  }
}

/**
 * GET /api/courses/[courseId]/join
 * 
 * Gateway for joining a Zoom meeting.
 * 1. Verifies user is authenticated and enrolled in course
 * 2. Checks if course uses the new Zoom system (starts on/before June 24, 2026)
 * 3. Checks if tutor is the CEO (if so, use Schoolhouse instead)
 * 4. Generates unique participant link if using new Zoom system
 * 5. Redirects to Zoom meeting URL or Schoolhouse link
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { courseId: string } }
) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const courseId = params.courseId;
    const classIdParam = req.nextUrl.searchParams.get("classId");

    if (!classIdParam) {
      return NextResponse.json(
        { error: "Missing classId parameter" },
        { status: 400 }
      );
    }

    // Get user info
    const { data: user, error: userError } = await supabase
      .from("app_users")
      .select("id, full_name, email")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get course info with tutor and first class date
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select(
        `
        id,
        title,
        tutor_id,
        schoolhouse_course_id,
        course_classes(starts_at)
      `
      )
      .eq("id", courseId)
      .single();

    if (courseError || !course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    // Get tutor info to check if they're the CEO
    const { data: tutor, error: tutorError } = await supabase
      .from("app_users")
      .select("id, email")
      .eq("id", course.tutor_id)
      .single();

    if (tutorError) {
      return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
    }

    // Check if tutor is CEO
    const ceoEmails = (process.env.NEXT_PUBLIC_FOUNDER_EMAIL || "").split(",");
    const isCEOTutor = ceoEmails.includes(tutor.email);

    // Get first class date to determine which system to use
    const sortedClasses = (course.course_classes || []).sort(
      (a: { starts_at: string }, b: { starts_at: string }) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
    const firstClassDate = sortedClasses[0]?.starts_at
      ? new Date(sortedClasses[0].starts_at)
      : null;
    const june24_2026 = new Date("2026-06-24T00:00:00Z");

    // Determine if this course should use new Zoom system
    const usesZoomSystem =
      !isCEOTutor && firstClassDate && firstClassDate <= june24_2026;

    if (!usesZoomSystem) {
      // Redirect to Schoolhouse
      if (course.schoolhouse_course_id) {
        return NextResponse.redirect(
          `https://www.schoolhouse.world/courses/${course.schoolhouse_course_id}`
        );
      }
      return NextResponse.json(
        { error: "Course does not have Schoolhouse link" },
        { status: 400 }
      );
    }

    // New Zoom system: verify enrollment and generate unique link
    // Check if user is enrolled
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("course_enrollments")
      .select("id, paid_at")
      .eq("course_id", courseId)
      .eq("student_id", userId)
      .single();

    if (enrollmentError || !enrollment || !enrollment.paid_at) {
      return NextResponse.json(
        { error: "Not enrolled or payment pending" },
        { status: 403 }
      );
    }

    // Get the class details to find the Zoom meeting
    const { data: courseClass, error: classError } = await supabase
      .from("course_classes")
      .select("id, zoom_meeting_id, zoom_start_url, zoom_join_url")
      .eq("id", classIdParam)
      .eq("course_id", courseId)
      .single();

    if (classError || !courseClass) {
      return NextResponse.json(
        { error: "Class not found" },
        { status: 404 }
      );
    }

    if (!courseClass.zoom_meeting_id) {
      return NextResponse.json(
        { error: "Zoom meeting not yet created" },
        { status: 400 }
      );
    }

    // Check if user is the tutor (host)
    const isHost = course.tutor_id === userId;

    if (isHost) {
      // Return host URL directly
      return NextResponse.json({
        joinUrl: courseClass.zoom_start_url,
        isHost: true,
        userName: user.full_name,
      });
    }

    // For students: generate or get unique participant link via registration
    try {
      const registrationResult = await registerZoomParticipant(
        courseClass.zoom_meeting_id,
        {
          email: user.email,
          first_name: user.full_name.split(" ")[0],
          last_name: user.full_name.split(" ").slice(1).join(" "),
        }
      );

      // Store the participant link for future reference
      await supabase.from("zoom_participant_links").insert({
        zoom_meeting_id: courseClass.zoom_meeting_id,
        student_id: userId,
        join_url: registrationResult.joinUrl,
      });

      return NextResponse.json({
        joinUrl: registrationResult.joinUrl,
        isHost: false,
        userName: user.full_name,
      });
    } catch (error) {
      // If participant already registered, get existing link
      const { data: existingLink } = await supabase
        .from("zoom_participant_links")
        .select("join_url")
        .eq("zoom_meeting_id", courseClass.zoom_meeting_id)
        .eq("student_id", userId)
        .single();

      if (existingLink) {
        return NextResponse.json({
          joinUrl: existingLink.join_url,
          isHost: false,
          userName: user.full_name,
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Error in join meeting endpoint:", error);
    return NextResponse.json(
      { error: "Failed to process meeting request" },
      { status: 500 }
    );
  }
}
