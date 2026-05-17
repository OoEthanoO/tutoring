/**
 * API route: /api/courses/[courseId]/[classId]/meeting-status
 * 
 * POST: Create a Zoom meeting for a class or mark meeting as started
 * GET: Get meeting status and check if it should auto-close
 * DELETE: End the meeting
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createZoomMeeting, deleteZoomMeeting } from "@/lib/zoom";
import { jwtDecode } from "jwt-decode";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface JwtPayload {
  sub: string;
}

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
 * POST: Create a Zoom meeting for a class or start the meeting
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; classId: string }> }
) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { courseId, classId } = await params;

    // Get user info
    const { data: user } = await supabase
      .from("app_users")
      .select("id, full_name, email")
      .eq("id", userId)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get course and class info
    const { data: courseClass, error: classError } = await supabase
      .from("course_classes")
      .select(
        `
        id,
        title,
        starts_at,
        duration_hours,
        zoom_meeting_id,
        zoom_start_url,
        course_id,
        course:courses(id, title, tutor_id)
      `
      )
      .eq("id", classId)
      .eq("course_id", courseId)
      .single();

    if (classError || !courseClass) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const course = Array.isArray(courseClass.course)
      ? courseClass.course[0]
      : courseClass.course;

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    // Only tutor (host) can create/manage the meeting
    if (course.tutor_id !== userId) {
      return NextResponse.json(
        { error: "Only the tutor can manage the meeting" },
        { status: 403 }
      );
    }

    // If meeting already exists, just mark it as started
    if (courseClass.zoom_meeting_id) {
      await supabase
        .from("zoom_meeting_sessions")
        .insert({
          course_class_id: classId,
          zoom_meeting_id: courseClass.zoom_meeting_id,
          host_user_id: userId,
          started_at: new Date().toISOString(),
        });

      return NextResponse.json({
        meetingId: courseClass.zoom_meeting_id,
        startUrl: courseClass.zoom_start_url,
        status: "already_created",
      });
    }

    // Create new Zoom meeting
    const startsAt = new Date(courseClass.starts_at);
    const durationHours = typeof courseClass.duration_hours === "number"
      ? courseClass.duration_hours
      : Number.parseFloat(String(courseClass.duration_hours || 1));

    const meeting = await createZoomMeeting({
      topic: `${course.title} - ${courseClass.title}`,
      start_time: startsAt.toISOString(),
      duration: Math.ceil(durationHours * 60),
      settings: {
        participant_video: true,
        host_video: true,
        waiting_room: false,
        join_before_host: false,
        enforce_login: false,
      },
    });

    // Store meeting info in database only if this class still has no meeting.
    // This prevents duplicate meetings if two requests race.
    const { data: claimedRows, error: updateError } = await supabase
      .from("course_classes")
      .update({
        zoom_meeting_id: meeting.meetingId,
        zoom_start_url: meeting.startUrl,
        zoom_join_url: meeting.joinUrl,
        zoom_created_at: new Date().toISOString(),
      })
      .eq("id", classId)
      .is("zoom_meeting_id", null)
      .select("id");

    if (updateError) {
      throw new Error(`Failed to save meeting info: ${updateError.message}`);
    }

    if (!claimedRows || claimedRows.length === 0) {
      // Another request already created/claimed a meeting for this class.
      // Best effort cleanup of this newly-created extra meeting.
      try {
        await deleteZoomMeeting(meeting.meetingId);
      } catch (cleanupError) {
        console.error("Failed to cleanup duplicate Zoom meeting:", cleanupError);
      }

      const { data: existingClass } = await supabase
        .from("course_classes")
        .select("zoom_meeting_id, zoom_start_url, zoom_join_url")
        .eq("id", classId)
        .single();

      if (!existingClass?.zoom_meeting_id) {
        throw new Error("Meeting claim race detected, but no existing meeting found.");
      }

      await supabase.from("zoom_meeting_sessions").insert({
        course_class_id: classId,
        zoom_meeting_id: existingClass.zoom_meeting_id,
        host_user_id: userId,
        started_at: new Date().toISOString(),
      });

      return NextResponse.json({
        meetingId: existingClass.zoom_meeting_id,
        startUrl: existingClass.zoom_start_url,
        joinUrl: existingClass.zoom_join_url,
        status: "already_created",
      });
    }

    // Create meeting session record
    await supabase
      .from("zoom_meeting_sessions")
      .insert({
        course_class_id: classId,
        zoom_meeting_id: meeting.meetingId,
        host_user_id: userId,
        started_at: new Date().toISOString(),
      });

    return NextResponse.json({
      meetingId: meeting.meetingId,
      startUrl: meeting.startUrl,
      joinUrl: meeting.joinUrl,
      password: meeting.password,
      status: "created",
    });
  } catch (error) {
    console.error("Error creating/starting meeting:", error);
    return NextResponse.json(
      { error: "Failed to manage meeting" },
      { status: 500 }
    );
  }
}

/**
 * GET: Check meeting status and auto-close if needed
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; classId: string }> }
) {
  try {
    const { classId } = await params;

    // Get class and meeting info
    const { data: courseClass } = await supabase
      .from("course_classes")
      .select(
        `
        id,
        title,
        starts_at,
        duration_hours,
        zoom_meeting_id,
        zoom_created_at
      `
      )
      .eq("id", classId)
      .single();

    if (!courseClass || !courseClass.zoom_meeting_id) {
      return NextResponse.json(
        { status: "not_created", shouldClose: false },
        { status: 200 }
      );
    }

    // Get the meeting session
    const { data: session } = await supabase
      .from("zoom_meeting_sessions")
      .select("id, started_at, ended_at, host_user_id")
      .eq("course_class_id", classId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      return NextResponse.json(
        { status: "not_started", shouldClose: false },
        { status: 200 }
      );
    }

    // Check if meeting should auto-close
    // Conditions: host not in meeting AND current time is after end time
    const now = new Date();
    const startsAt = new Date(courseClass.starts_at);
    const durationHours = typeof courseClass.duration_hours === "number"
      ? courseClass.duration_hours
      : Number.parseFloat(String(courseClass.duration_hours || 1));
    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);

    const shouldClose = !session.ended_at && now > endsAt;

    return NextResponse.json({
      status: "active",
      started: !!session.started_at,
      ended: !!session.ended_at,
      shouldClose,
      meetingId: courseClass.zoom_meeting_id,
      endTime: endsAt.toISOString(),
    });
  } catch (error) {
    console.error("Error checking meeting status:", error);
    return NextResponse.json(
      { error: "Failed to check meeting status" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: End the meeting
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; classId: string }> }
) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { classId } = await params;

    // Get class and meeting info
    const { data: courseClass } = await supabase
      .from("course_classes")
      .select("id, zoom_meeting_id")
      .eq("id", classId)
      .single();

    if (!courseClass || !courseClass.zoom_meeting_id) {
      return NextResponse.json(
        { error: "Meeting not found" },
        { status: 404 }
      );
    }

    // Get session to verify user is the host
    const { data: session } = await supabase
      .from("zoom_meeting_sessions")
      .select("host_user_id")
      .eq("course_class_id", classId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Allow deletion by host or automatic system (no user)
    if (session && session.host_user_id !== userId && userId) {
      return NextResponse.json(
        { error: "Only the host can end the meeting" },
        { status: 403 }
      );
    }

    // Delete meeting via Zoom API
    try {
      await deleteZoomMeeting(courseClass.zoom_meeting_id);
    } catch (error) {
      console.error("Error deleting from Zoom:", error);
      // Continue even if Zoom deletion fails
    }

    // Mark meeting as ended in database
    if (session) {
      await supabase
        .from("zoom_meeting_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("course_class_id", classId)
        .order("created_at", { ascending: false })
        .limit(1);
    }

    // Clear meeting info from course_classes
    await supabase
      .from("course_classes")
      .update({
        zoom_meeting_id: null,
        zoom_start_url: null,
        zoom_join_url: null,
      })
      .eq("id", classId);

    return NextResponse.json({ status: "ended" });
  } catch (error) {
    console.error("Error ending meeting:", error);
    return NextResponse.json(
      { error: "Failed to end meeting" },
      { status: 500 }
    );
  }
}
