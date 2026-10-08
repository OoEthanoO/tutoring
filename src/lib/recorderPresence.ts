/**
 * Which tutors have YanLearn Recorder open and connected right now, and on
 * which version — for the founder trio's Recorders tab.
 *
 * "Connected" is read from the heartbeat every open recorder sends with each
 * tick (`recorder_sessions.last_seen_at`): every 30 s when idle, every 2 s near
 * a class. A recorder that is closed, asleep, or offline simply stops sending
 * it, so the three cannot be told apart — only "heard from recently" or not.
 *
 * Pure and unit tested; the route (api/admin/recorder-status) does the reads.
 */

/** Three missed idle heartbeats (30 s apart) and a recorder counts as gone. */
export const recorderConnectedWithinMs = 90 * 1000;

export type RecorderSessionRow = {
  tutor_id: string;
  device_id: string;
  device_name: string | null;
  platform: string | null;
  app_version: string | null;
  last_state: string | null;
  current_class_id: string | null;
  last_seen_at: string;
};

export type TutorRow = { id: string; name: string; email: string };

export type RecorderDevice = {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string | null;
  state: string;
  stateLabel: string;
  connected: boolean;
  lastSeenAt: string;
  currentClassId: string | null;
  outdated: boolean;
};

export type TutorRecorderStatus = {
  tutorId: string;
  name: string;
  email: string;
  /** Any of their recorders is connected. */
  connected: boolean;
  /** The most recent heartbeat from any of their recorders, or null if none ever. */
  lastSeenAt: string | null;
  /** Their connected recorder (or, if none, the most recently seen) is older than the latest release. */
  outdated: boolean;
  devices: RecorderDevice[];
};

/**
 * Compare two dotted versions ("0.5.10" > "0.5.9"). Anything unparseable
 * sorts as oldest, so it is never mistaken for up to date.
 */
export const compareVersions = (a: string | null | undefined, b: string | null | undefined): number => {
  const parse = (value: string | null | undefined) =>
    String(value ?? "")
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const left = parse(a);
  const right = parse(b);
  const leftValid = left.length > 0 && left.every(Number.isFinite);
  const rightValid = right.length > 0 && right.every(Number.isFinite);
  if (!leftValid || !rightValid) {
    return leftValid === rightValid ? 0 : leftValid ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
};

/** What the recorder was doing, in words (see currentStateLabel in recorder/src/main.js). */
export const recorderStateLabel = (state: string | null | undefined): string => {
  const value = String(state ?? "").trim();
  if (value === "idle" || value === "") return "Idle";
  if (value === "pre_arm") return "Getting ready for a class";
  if (value === "armed") return "Ready, class about to start";
  if (value === "recording") return "Recording";
  if (value === "paused") return "Not recording — reason not reported";
  if (value.startsWith("paused_")) return "Paused by the tutor";
  if (value === "finalizing") return "Preparing the recording";
  if (value === "uploading") return "Uploading";
  if (value === "capture_failed") return "Not recording — capture failed";
  if (value === "preparation_failed") return "Recording preparation failed — retrying";
  if (value === "upload_failed") return "Upload needs attention";
  if (value === "waiting_for_devices") return "Not recording — choose recording devices";
  if (value === "waiting_for_voice") return "Not recording — waiting for the class voice channel";
  if (value === "reconnecting") return "Not recording — reconnecting to the server";
  if (value === "starting") return "Starting recording";
  if (value === "test") return "Test mode";
  return value;
};

export const summarizeTutorRecorders = ({
  tutors,
  sessions,
  nowMs,
  latestVersion,
}: {
  tutors: TutorRow[];
  sessions: RecorderSessionRow[];
  nowMs: number;
  /** The newest published release, or null when it could not be looked up. */
  latestVersion: string | null;
}): TutorRecorderStatus[] => {
  const sessionsByTutor = new Map<string, RecorderSessionRow[]>();
  for (const session of sessions) {
    const list = sessionsByTutor.get(session.tutor_id) ?? [];
    list.push(session);
    sessionsByTutor.set(session.tutor_id, list);
  }

  const rows = tutors.map((tutor): TutorRecorderStatus => {
    const devices = (sessionsByTutor.get(tutor.id) ?? [])
      .map((session): RecorderDevice => {
        const seenMs = Date.parse(session.last_seen_at);
        const connected = Number.isFinite(seenMs) && nowMs - seenMs <= recorderConnectedWithinMs;
        return {
          deviceId: session.device_id,
          deviceName: String(session.device_name ?? "").trim() || "Unnamed computer",
          platform: String(session.platform ?? "").trim(),
          appVersion: String(session.app_version ?? "").trim() || null,
          state: String(session.last_state ?? ""),
          stateLabel: recorderStateLabel(session.last_state),
          connected,
          lastSeenAt: session.last_seen_at,
          currentClassId: session.current_class_id,
          outdated: Boolean(latestVersion) && compareVersions(session.app_version, latestVersion) < 0,
        };
      })
      .sort((a, b) => Number(b.connected) - Number(a.connected) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    const lead = devices[0] ?? null;
    return {
      tutorId: tutor.id,
      name: tutor.name,
      email: tutor.email,
      connected: devices.some((device) => device.connected),
      lastSeenAt: lead?.lastSeenAt ?? null,
      outdated: lead?.outdated ?? false,
      devices,
    };
  });

  // Connected first, then most recently seen, then tutors who never signed in.
  return rows.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    const aSeen = a.lastSeenAt ? Date.parse(a.lastSeenAt) : -Infinity;
    const bSeen = b.lastSeenAt ? Date.parse(b.lastSeenAt) : -Infinity;
    if (aSeen !== bSeen) return bSeen - aSeen;
    return a.name.localeCompare(b.name);
  });
};
