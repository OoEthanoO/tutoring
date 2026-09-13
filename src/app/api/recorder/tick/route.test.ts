import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), presence: vi.fn() }));
vi.mock("@/lib/authServer", () => ({ getAdminClient: mocks.admin }));
vi.mock("@/lib/recorderAuth", () => ({ getRecorderUser: mocks.user }));
vi.mock("@/lib/discordVoice", () => ({ discordVoiceLookupEnabled: () => true, isAnyAccountInVoiceChannel: mocks.presence }));

const start = Date.parse("2026-09-12T19:00:00-04:00");
const end = start + 90 * 60000;
type Setup = { removedAt?: number; channelMissing?: boolean; failTable?: string; alreadyFinished?: boolean };
const setup = ({ removedAt, channelMissing, failTable, alreadyFinished }: Setup = {}) => {
  vi.useFakeTimers();
  vi.setSystemTime(start + 60000);
  mocks.user.mockResolvedValue({ id: "tutor", email: "tutor@example.test", role: "executive", discord_user_id: "discord-tutor" });
  mocks.presence.mockResolvedValue(true);
  mocks.admin.mockReturnValue({ from: (table: string) => {
    let writing = false;
    const rows = () => {
      if (writing) return [];
      if (table === "courses") return [{ id: "science", title: "Science", created_by: "tutor", recordings_enabled: true,
        course_classes: [{ id: "class-7", title: "Class 7", starts_at: new Date(start).toISOString(), duration_hours: 1.5 }] }];
      if (table === "app_users") return [{ id: "tutor", email: "tutor@example.test", role: "executive" }];
      if (table === "course_classes") return [{ course_id: "science", starts_at: new Date(start).toISOString() }];
      if (table === "recorder_class_sessions" && alreadyFinished) return [{ id: "session", class_id: "class-7", finished_at: new Date(start).toISOString() }];
      if (table === "class_recordings" && alreadyFinished) return [{ class_id: "class-7" }];
      if (table === "discord_live_class_channels" && !channelMissing) return [{ discord_channel_id: "voice", deleted_at: removedAt === undefined ? null : new Date(removedAt).toISOString() }];
      return [];
    };
    const result = () => table === failTable ? { data: null, error: { message: "Gateway Timeout" } } : { data: rows(), error: null };
    const query = {
      select: () => query, eq: () => query, or: () => query, is: () => query,
      gte: () => query, lte: () => query, in: () => query,
      update: () => { writing = true; return query; },
      upsert: () => { writing = true; return query; },
      insert: () => { writing = true; return query; },
      maybeSingle: async () => { const read = result(); return { ...read, data: read.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } });
};
const tick = () => POST(new NextRequest("https://example.test/api/recorder/tick", {
  method: "POST", body: JSON.stringify({ deviceId: "device", state: "recording", classId: "class-7" }),
}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("recorder tick through a live-channel outage", () => {
  it("keeps old Recorder versions recording after a premature deletion", async () => {
    setup({ removedAt: start });
    const data = await (await tick()).json();
    expect(data.active.classId).toBe("class-7");
    expect(data.active.mustFinalize).toBe(false);
    expect(data.active.liveChannel.deleted).toBe(false);
    expect(data.active.tutorInLiveChannel).toBeNull();
  });
  it.each([{ channelMissing: true }, { failTable: "discord_live_class_channels" }])("preserves the previous capture state when the channel is unknown: %j", async (options) => {
    setup(options);
    const data = await (await tick()).json();
    expect(data.active.mustFinalize).toBe(false);
    expect(data.active.tutorInLiveChannel).toBeNull();
  });
  it.each(["app_users", "course_classes"])("returns a retryable error instead of ending a class when %s fails", async (failTable) => {
    setup({ failTable });
    expect((await tick()).status).toBe(503);
  });
  it("reassigns a class an older client prematurely finished, until the scheduled end", async () => {
    setup({ alreadyFinished: true });
    expect((await (await tick()).json()).active.classId).toBe("class-7");
  });
  it("finalizes a legitimate deletion after class end", async () => {
    setup({ removedAt: end + 6 * 60000 });
    vi.setSystemTime(end + 7 * 60000);
    const data = await (await tick()).json();
    expect(data.active.mustFinalize).toBe(true);
    expect(data.active.tutorInLiveChannel).toBe(false);
  });
});
