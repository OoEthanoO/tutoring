import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { relabelClassesForCourse } from "@/lib/classTools";
import {
  formatCourseChangeDateTime,
  formatCourseChangeDiscordDateTime,
  notifyCourseTutorsOfChanges,
  type CourseChangeItem,
} from "@/lib/courseChangeNotifications";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";



export async function PATCH(
  request: NextRequest,
  { params }: { params: { classId: string } | Promise<{ classId: string }> }
) {
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
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const classId = resolvedParams?.classId ?? "";
  if (!classId) {
    return NextResponse.json({ error: "Missing class id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        startsAt?: string;
        durationHours?: number;
        bulkClassUpdates?: { classId: string; startsAt?: string; durationHours?: number }[];
      }
    | null;

  const nextTitle = body?.title?.trim();
  const nextStartsAt = body?.startsAt?.trim();

  if (!nextTitle && !nextStartsAt && typeof body?.durationHours !== "number") {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }



  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: classRow, error: classError } = await adminClient
    .from("course_classes")
    .select("id, course_id, title, starts_at, duration_hours")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return NextResponse.json(
      { error: classError?.message ?? "Class not found." },
      { status: 404 }
    );
  }

  const { data: courseRow, error: courseError } = await adminClient
    .from("courses")
    .select("id, created_by")
    .eq("id", classRow.course_id)
    .single();

  if (courseError || !courseRow) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const isFounderUser = isFounder(role);
  if (!isFounderUser) {
    return NextResponse.json({ error: "Forbidden. Only founders, CEOs, and COOs can edit classes." }, { status: 403 });
  }

  const updates: Record<string, string | number> = {};
  if (nextTitle) {
    updates.title = nextTitle;
  }
  if (nextStartsAt) {
    updates.starts_at = nextStartsAt;
  }
  if (isFounder(role) && typeof body?.durationHours === "number") {
    updates.duration_hours = body.durationHours;
  }

  const { data: updated, error: updateError } = await adminClient
    .from("course_classes")
    .update(updates)
    .eq("id", classId)
    .select("id, title, starts_at, duration_hours, created_at")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update class." },
      { status: 500 }
    );
  }

  await relabelClassesForCourse(classRow.course_id, adminClient);

  const { data: latestClass } = await adminClient
    .from("course_classes")
    .select("id, title, starts_at, duration_hours, created_at")
    .eq("id", classId)
    .single();

  const primaryUpdatedClass = latestClass || updated;
  const allUpdatedClasses = [primaryUpdatedClass];
  const notificationChanges: (string | CourseChangeItem)[] = [];
  if (nextTitle && nextTitle !== classRow.title) {
    notificationChanges.push(`Class name changed from "${classRow.title ?? "Untitled"}" to "${nextTitle}".`);
  }
  if (nextStartsAt && new Date(nextStartsAt).toISOString() !== new Date(classRow.starts_at).toISOString()) {
    const movedLabel = `${primaryUpdatedClass.title || "A class"} was moved from`;
    notificationChanges.push({
      text: `${movedLabel} ${formatCourseChangeDateTime(classRow.starts_at)} to ${formatCourseChangeDateTime(primaryUpdatedClass.starts_at)}.`,
      discordText: `${movedLabel} ${formatCourseChangeDiscordDateTime(classRow.starts_at)} to ${formatCourseChangeDiscordDateTime(primaryUpdatedClass.starts_at)}.`,
    });
  }
  if (
    isFounder(role) &&
    typeof body?.durationHours === "number" &&
    body.durationHours !== classRow.duration_hours
  ) {
    notificationChanges.push(`${primaryUpdatedClass.title || "A class"} duration changed from ${classRow.duration_hours ?? 1}h to ${body.durationHours}h.`);
  }

  const updatesList = body?.bulkClassUpdates;
  let bulkShiftCount = 0;
  if (Array.isArray(updatesList) && updatesList.length > 0) {
    for (const update of updatesList) {
      if (!update.classId || (!update.startsAt && typeof update.durationHours !== "number")) {
        continue;
      }

      const bulkUpdatePayload: { starts_at?: string; duration_hours?: number } = {};
      if (update.startsAt) {
        bulkUpdatePayload.starts_at = new Date(update.startsAt).toISOString();
      }
      if (isFounder(role) && typeof update.durationHours === "number") {
        bulkUpdatePayload.duration_hours = update.durationHours;
      }

      // To ensure security, check the subclass belongs to the same course_id
      const { data: shiftedClass } = await adminClient
        .from("course_classes")
        .update(bulkUpdatePayload)
        .eq("id", update.classId)
        .eq("course_id", classRow.course_id)
        .select("id, title, starts_at, duration_hours, created_at")
        .single();
        
      if (shiftedClass) {
        allUpdatedClasses.push(shiftedClass);
        bulkShiftCount += 1;
      }
    }
  }

  if (bulkShiftCount > 0) {
    notificationChanges.push(`${bulkShiftCount} additional class${bulkShiftCount === 1 ? "" : "es"} in the schedule ${bulkShiftCount === 1 ? "was" : "were"} shifted.`);
  }

  const changedBy = String(user.full_name ?? "").trim() || user.email || "a YanLearn admin";
  await notifyCourseTutorsOfChanges(adminClient, classRow.course_id, notificationChanges, changedBy);

  return NextResponse.json({
    class: primaryUpdatedClass,
    updatedClasses: allUpdatedClasses,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { classId: string } | Promise<{ classId: string }> }
) {
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
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const classId = resolvedParams?.classId ?? "";
  if (!classId) {
    return NextResponse.json({ error: "Missing class id." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: classRow, error: classError } = await adminClient
    .from("course_classes")
    .select("id, course_id, title, starts_at")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return NextResponse.json(
      { error: classError?.message ?? "Class not found." },
      { status: 404 }
    );
  }

  const { data: courseRow, error: courseError } = await adminClient
    .from("courses")
    .select("created_by")
    .eq("id", classRow.course_id)
    .single();

  if (courseError || !courseRow) {
    return NextResponse.json(
      { error: courseError?.message ?? "Course not found." },
      { status: 404 }
    );
  }

  const isFounderUser = isFounder(role);
  if (!isFounderUser) {
    return NextResponse.json({ error: "Forbidden. Only founders, CEOs, and COOs can delete classes." }, { status: 403 });
  }

  const { error: deleteError } = await adminClient
    .from("course_classes")
    .delete()
    .eq("id", classId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to delete class." },
      { status: 500 }
    );
  }

  await relabelClassesForCourse(classRow.course_id, adminClient);

  const changedBy = String(user.full_name ?? "").trim() || user.email || "a YanLearn admin";
  await notifyCourseTutorsOfChanges(adminClient, classRow.course_id, [
    {
      text: `${classRow.title || "A class"} scheduled for ${formatCourseChangeDateTime(classRow.starts_at)} was removed.`,
      discordText: `${classRow.title || "A class"} scheduled for ${formatCourseChangeDiscordDateTime(classRow.starts_at)} was removed.`,
    },
  ], changedBy);

  return NextResponse.json({ success: true });
}
