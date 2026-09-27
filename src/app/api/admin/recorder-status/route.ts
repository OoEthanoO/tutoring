import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestAuthContext } from "@/lib/authServer";
import { isExecutive, isFounder, resolveAccountRole } from "@/lib/roles";
import { chunks, fetchAllRows, idChunkSize } from "@/lib/supabasePaging";
import { getLatestRecorderRelease, recorderVersion } from "@/lib/recorderRelease";
import { summarizeTutorRecorders, type RecorderSessionRow } from "@/lib/recorderPresence";

/**
 * Which tutors have YanLearn Recorder open and connected, what it is doing,
 * and which version it is on. Founder trio only. See src/lib/recorderPresence.ts.
 */

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  custom_role: string | null;
  custom_roles: { role_level?: string | null } | { role_level?: string | null }[] | null;
};

export async function GET(request: NextRequest) {
  const { actor } = await getRequestAuthContext(request);
  if (!actor || !isFounder(resolveAccountRole(actor))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = getAdminClient();
  let users: UserRow[];
  let sessions: RecorderSessionRow[];
  try {
    [users, sessions] = await Promise.all([
      fetchAllRows<UserRow>((from, to) =>
        db
          .from("app_users")
          .select("id, email, full_name, role, custom_role, custom_roles(role_level)")
          .not("email_verified_at", "is", null)
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<RecorderSessionRow>((from, to) =>
        db
          .from("recorder_sessions")
          .select("tutor_id, device_id, device_name, platform, app_version, last_state, current_class_id, last_seen_at")
          .order("id")
          .range(from, to)
      ),
    ]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load recorder status." },
      { status: 500 }
    );
  }

  // Unknown if GitHub cannot be reached: then nothing is flagged as outdated.
  const latestVersion = recorderVersion(await getLatestRecorderRelease());

  const tutors = users
    .filter((user) => isExecutive(resolveAccountRole(user)))
    .map((user) => ({
      id: String(user.id),
      name: String(user.full_name ?? "").trim() || String(user.email ?? "Unnamed tutor"),
      email: String(user.email ?? ""),
    }));
  const tutorIds = new Set(tutors.map((tutor) => tutor.id));

  const rows = summarizeTutorRecorders({
    tutors,
    sessions: sessions.filter((session) => tutorIds.has(String(session.tutor_id))),
    nowMs: Date.now(),
    latestVersion,
  });

  // Name the class a recorder is busy with, for the ones that are.
  const classIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.devices.filter((device) => device.connected && device.currentClassId).map((device) => String(device.currentClassId))
      )
    ),
  ];
  const classTitles = new Map<string, string>();
  for (const ids of chunks(classIds, idChunkSize)) {
    const { data } = await db
      .from("course_classes")
      .select("id, title, course:courses(title)")
      .in("id", ids);
    for (const row of data ?? []) {
      const course = (Array.isArray(row.course) ? row.course[0] : row.course) as { title?: string | null } | null;
      classTitles.set(
        String(row.id),
        [course?.title, row.title].filter((part) => String(part ?? "").trim()).join(" — ")
      );
    }
  }

  return NextResponse.json({
    latestVersion,
    generatedAt: new Date().toISOString(),
    tutorCount: rows.length,
    connectedCount: rows.filter((row) => row.connected).length,
    tutors: rows.map((row) => ({
      ...row,
      devices: row.devices.map((device) => ({
        ...device,
        currentClassTitle: device.currentClassId ? classTitles.get(String(device.currentClassId)) ?? null : null,
      })),
    })),
  });
}
