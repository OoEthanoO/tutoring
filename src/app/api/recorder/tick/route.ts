import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { classEndMs } from "@/lib/classTiming";
import { discordVoiceLookupEnabled, isAnyAccountInVoiceChannel } from "@/lib/discordVoice";
import { getRecorderUser } from "@/lib/recorderAuth";
import { classUsesDiscordVoiceSystem } from "@/lib/discordLiveChannels";
import { isFounder, resolveUserRole } from "@/lib/roles";
import {
  pickActiveRecorderClass,
  recorderActivePollMs,
  recorderIdlePollMs,
  recorderMandatoryFromMs,
  recorderMaxHoldAfterEndMs,
  recorderMustFinalize,
  recorderPreArmBeforeStartMs,
  recorderQuitLocked,
} from "@/lib/recorderPolicy";

export const dynamic = "force-dynamic";

type TickBody = {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  /** Free-form client state for the admin's benefit (idle, armed, recording, ...). */
  state?: string;
  /** The class the client is currently working on, if any. */
  classId?: string;
  /** The client is done with a class: it uploaded, or had nothing to upload. */
  finished?: { classId?: string; reason?: string } | null;
};

type ClassCandidate = {
  id: string;
  courseId: string;
  courseTitle: string;
  classTitle: string;
  startsAtMs: number;
  endsAtMs: number;
  released: boolean;
};

/**
 * Heartbeat + state feed for the YanLearn Recorder. The client calls this
 * every couple of seconds while a class is near and every 30 s otherwise; the
 * response tells it which class it is responsible for, what phase that class
 * is in, whether the tutor is in the live voice channel right now, and whether
 * the live channel has been torn down (which forces the upload).
 *
 * The client keeps its own state machine; this endpoint is the single source
 * of truth for time, class schedule, and Discord presence.
 */
export async function POST(request: NextRequest) {
  const user = await getRecorderUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as TickBody;
  const deviceId = String(body.deviceId ?? "").trim();
  if (!deviceId) {
    return NextResponse.json({ error: "Missing device id." }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const reportedState = String(body.state ?? "").slice(0, 40) || null;
  const reportedClassId = String(body.classId ?? "").trim() || null;

  // --- Heartbeat --------------------------------------------------------------
  await adminClient.from("recorder_sessions").upsert(
    {
      tutor_id: user.id,
      device_id: deviceId,
      device_name: String(body.deviceName ?? "").slice(0, 120) || null,
      platform: String(body.platform ?? "").slice(0, 40) || null,
      app_version: String(body.appVersion ?? "").slice(0, 40) || null,
      last_state: reportedState,
      current_class_id: reportedClassId,
      last_seen_at: nowIso,
    },
    { onConflict: "tutor_id,device_id" }
  );

  // --- Release a class the client is done with ---------------------------------
  const finishedClassId = String(body.finished?.classId ?? "").trim();
  if (finishedClassId) {
    const finishReason = String(body.finished?.reason ?? "").slice(0, 40) || "uploaded";
    await adminClient.from("recorder_class_sessions").upsert(
      {
        class_id: finishedClassId,
        tutor_id: user.id,
        device_id: deviceId,
        last_seen_at: nowIso,
        last_state: "finished",
        finished_at: nowIso,
        finish_reason: finishReason,
      },
      { onConflict: "class_id,tutor_id" }
    );
  }

  // --- Which class is the recorder responsible for? ----------------------------
  // Only classes that could possibly be active: from the longest class that
  // could still be inside the after-end hold, to the pre-arm horizon.
  const windowStartMs = nowMs - recorderMaxHoldAfterEndMs - 12 * 60 * 60 * 1000;
  const windowEndMs = nowMs + recorderPreArmBeforeStartMs;
  const { data: courseRows, error: coursesError } = await adminClient
    .from("courses")
    .select("id, title, created_by, created_by_email, recordings_enabled, course_classes(id, title, starts_at, duration_hours)")
    .or(`created_by.eq.${user.id},co_tutor_id.eq.${user.id}`)
    .is("deleted_at", null)
    .gte("course_classes.starts_at", new Date(windowStartMs).toISOString())
    .lte("course_classes.starts_at", new Date(windowEndMs).toISOString());
  if (coursesError) {
    return NextResponse.json({ error: coursesError.message }, { status: 500 });
  }
  // The recorder only has anything to do with classes held in a Discord voice
  // channel: it records while the tutor is in that channel, so for a class on
  // Schoolhouse or the legacy Zoom flow there is nothing it can ever capture.
  // Claiming one anyway used to arm the app and hold it locked for hours over a
  // class it could not record.
  const creatorIds = Array.from(
    new Set(
      (courseRows ?? [])
        .map((course) => String(course.created_by ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
  const creatorById = new Map<string, { email: string; role: string | null }>();
  if (creatorIds.length > 0) {
    const { data: creatorRows, error: creatorError } = await adminClient
      .from("app_users")
      .select("id, email, role")
      .in("id", creatorIds);
    if (creatorError) return NextResponse.json({ error: creatorError.message }, { status: 503 });
    for (const row of creatorRows ?? []) {
      creatorById.set(String(row.id), {
        email: String(row.email ?? ""),
        role: row.role ? String(row.role) : null,
      });
    }
  }

  // The Zoom-era cutoff is judged by a course's *first* class, which the window
  // above deliberately does not include.
  const courseIds = Array.from(new Set((courseRows ?? []).map((course) => String(course.id))));
  const firstClassMsByCourse = new Map<string, number>();
  if (courseIds.length > 0) {
    const { data: allClassRows, error: firstClassError } = await adminClient
      .from("course_classes")
      .select("course_id, starts_at")
      .in("course_id", courseIds);
    if (firstClassError) return NextResponse.json({ error: firstClassError.message }, { status: 503 });
    for (const row of allClassRows ?? []) {
      const startsAtMs = new Date(String(row.starts_at)).getTime();
      if (!Number.isFinite(startsAtMs)) {
        continue;
      }
      const courseId = String(row.course_id);
      const known = firstClassMsByCourse.get(courseId);
      if (known === undefined || startsAtMs < known) {
        firstClassMsByCourse.set(courseId, startsAtMs);
      }
    }
  }

  const courseOnDiscordVoice = (course: { id: unknown; created_by?: unknown; created_by_email?: unknown }, classStartMs: number) => {
    const creator = creatorById.get(String(course.created_by ?? ""));
    const email = creator?.email || String(course.created_by_email ?? "");
    const founderTaught = isFounder(resolveUserRole(email, creator?.role ?? null));
    const firstClassMs = firstClassMsByCourse.get(String(course.id));
    return classUsesDiscordVoiceSystem({
      founderTaught,
      firstClassDate: firstClassMs === undefined ? null : new Date(firstClassMs),
      classStart: new Date(classStartMs),
    });
  };

  const candidates: ClassCandidate[] = [];
  for (const course of courseRows ?? []) {
    // Courses that opted out of recording are not the recorder's business at
    // all: claiming one would arm the app and hold it locked over a class it
    // is not supposed to capture.
    if (course.recordings_enabled === false) {
      continue;
    }
    for (const cls of course.course_classes ?? []) {
      const startsAtMs = new Date(String(cls.starts_at)).getTime();
      if (!Number.isFinite(startsAtMs) || startsAtMs < windowStartMs || startsAtMs > windowEndMs) {
        continue;
      }
      if (!courseOnDiscordVoice(course, startsAtMs)) {
        continue;
      }
      candidates.push({
        id: String(cls.id),
        courseId: String(course.id),
        courseTitle: String(course.title ?? ""),
        classTitle: String(cls.title ?? ""),
        startsAtMs,
        endsAtMs: classEndMs(startsAtMs, cls.duration_hours),
        released: false,
      });
    }
  }

  if (candidates.length > 0) {
    const classIds = candidates.map((candidate) => candidate.id);
    const [{ data: sessionRows }, { data: readyRecordings }] = await Promise.all([
      adminClient
        .from("recorder_class_sessions")
        .select("class_id, finished_at")
        .eq("tutor_id", user.id)
        .in("class_id", classIds),
      adminClient
        .from("class_recordings")
        .select("class_id")
        .eq("tutor_id", user.id)
        .eq("status", "ready")
        .in("class_id", classIds),
    ]);
    const releasedIds = new Set<string>();
    for (const row of sessionRows ?? []) {
      if (row.finished_at) {
        releasedIds.add(String(row.class_id));
      }
    }
    for (const row of readyRecordings ?? []) {
      releasedIds.add(String(row.class_id));
    }
    for (const candidate of candidates) {
      // An older client may already have finalized after a premature channel
      // deletion. Keep assigning the live class so it can record the remainder.
      candidate.released = nowMs >= candidate.endsAtMs && releasedIds.has(candidate.id);
    }
  }

  const picked = pickActiveRecorderClass(nowMs, candidates);
  if (!picked) {
    return NextResponse.json({
      serverTimeMs: nowMs,
      pollIntervalMs: recorderIdlePollMs,
      mandatoryFromMs: recorderMandatoryFromMs,
      tutor: { id: user.id, name: user.full_name ?? user.email },
      active: null,
      nextClass: nextUpcomingClass(nowMs, candidates),
    });
  }

  const { classRow, phase } = picked;

  // Record when this recorder first saw the class (the "open 5 minutes before"
  // rule is judged from first_seen_at) without touching it on later ticks.
  const { data: existingSession } = await adminClient
    .from("recorder_class_sessions")
    .select("id, first_seen_at, recording_started_at")
    .eq("class_id", classRow.id)
    .eq("tutor_id", user.id)
    .maybeSingle();
  const recordingStartedAt =
    existingSession?.recording_started_at ??
    (reportedState === "recording" && reportedClassId === classRow.id ? nowIso : null);
  if (existingSession) {
    await adminClient
      .from("recorder_class_sessions")
      .update({
        device_id: deviceId,
        last_seen_at: nowIso,
        last_state: reportedState,
        ...(recordingStartedAt ? { recording_started_at: recordingStartedAt } : {}),
      })
      .eq("id", existingSession.id);
  } else {
    await adminClient.from("recorder_class_sessions").insert({
      class_id: classRow.id,
      tutor_id: user.id,
      device_id: deviceId,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      last_state: reportedState,
      recording_started_at: recordingStartedAt,
    });
  }

  // --- Live voice channel and the tutor's presence in it -----------------------
  const { data: liveChannel, error: liveChannelError } = await adminClient
    .from("discord_live_class_channels")
    .select("discord_channel_id, deleted_at, created_at")
    .eq("class_id", classRow.id)
    .maybeSingle();
  const liveChannelId = liveChannel ? String(liveChannel.discord_channel_id) : null;
  const removedAtMs = liveChannel?.deleted_at ? Date.parse(liveChannel.deleted_at) : null;
  // A deletion before the real end is an interruption, even before recovery
  // repairs its row. Older Recorder versions also need a non-finalizing tick.
  const liveChannelDeleted = removedAtMs !== null && Number.isFinite(removedAtMs) &&
    removedAtMs >= classRow.endsAtMs && nowMs >= classRow.endsAtMs;
  const liveChannelExists = !liveChannelError && Boolean(liveChannelId) && !liveChannel?.deleted_at;

  let tutorInLiveChannel: boolean | null = null;
  let presenceReason: string | null = null;
  if ((phase === "live" || phase === "after_end") && liveChannelExists && liveChannelId) {
    if (!discordVoiceLookupEnabled()) {
      presenceReason = "Discord is not configured on the server.";
    } else {
      const tutorDiscordId = String(user.discord_user_id ?? "").trim();
      const { data: extraAccounts } = await adminClient
        .from("approved_discord_accounts")
        .select("discord_user_id")
        .eq("owner_user_id", user.id);
      const accountIds = [
        tutorDiscordId,
        ...(extraAccounts ?? []).map((row) => String(row.discord_user_id ?? "").trim()),
      ].filter(Boolean);
      if (accountIds.length === 0) {
        presenceReason = "Connect your Discord account on the website so the recorder can see when you are in the call.";
      } else {
        tutorInLiveChannel = await isAnyAccountInVoiceChannel(accountIds, liveChannelId);
        if (tutorInLiveChannel === null) {
          presenceReason = "Discord voice lookup failed; keeping the previous state.";
        }
      }
    }
  } else if (phase === "live" || phase === "after_end") {
    tutorInLiveChannel = liveChannelDeleted ? false : null;
    presenceReason = liveChannelError
      ? "Could not read the live channel; keeping the previous recording state."
      : liveChannelDeleted
      ? "The live voice channel has been deleted."
      : "Waiting for the live voice channel to be created or recovered.";
  }

  // A class whose channel never existed at all cannot be "deleted"; the
  // after-end safety valve releases those instead.
  const mustFinalize = recorderMustFinalize({ phase, liveChannelDeleted });

  return NextResponse.json({
    serverTimeMs: nowMs,
    pollIntervalMs: recorderActivePollMs,
    mandatoryFromMs: recorderMandatoryFromMs,
    tutor: { id: user.id, name: user.full_name ?? user.email },
    active: {
      classId: classRow.id,
      courseId: classRow.courseId,
      courseTitle: classRow.courseTitle,
      classTitle: classRow.classTitle,
      startsAtMs: classRow.startsAtMs,
      endsAtMs: classRow.endsAtMs,
      phase,
      quitLocked: recorderQuitLocked(phase),
      mustFinalize,
      liveChannel: {
        id: liveChannelId,
        exists: liveChannelExists,
        deleted: liveChannelDeleted,
      },
      tutorInLiveChannel,
      presenceReason,
    },
    nextClass: null,
  });
}

const nextUpcomingClass = (nowMs: number, candidates: ClassCandidate[]) => {
  let next: ClassCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.startsAtMs <= nowMs || candidate.released) {
      continue;
    }
    if (!next || candidate.startsAtMs < next.startsAtMs) {
      next = candidate;
    }
  }
  return next
    ? {
        classId: next.id,
        courseTitle: next.courseTitle,
        classTitle: next.classTitle,
        startsAtMs: next.startsAtMs,
        endsAtMs: next.endsAtMs,
      }
    : null;
};
