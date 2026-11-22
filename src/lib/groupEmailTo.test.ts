import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Group emails go To a mailbox that accepts mail, never the sender address:
 * with the sender in To, every group email bounced on it (see groupEmailTo).
 */

let notifications: typeof import("./notificationsServer");
const fetcher = vi.fn<typeof fetch>();

beforeAll(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM", "YanLearn <learn@notifications.example.test>");
  vi.stubGlobal("fetch", fetcher);
  notifications = await import("./notificationsServer");
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => {
  fetcher.mockReset();
  fetcher.mockResolvedValue(new Response(JSON.stringify({ id: "email" }), { status: 200 }));
  vi.stubEnv("GROUP_EMAIL_TO", "");
});

const sentBodies = () => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

describe("group emails", () => {
  it("are addressed to the organization's inbox, with the families in Bcc", async () => {
    const result = await notifications.sendBccEmail(["One@Example.test", "two@example.test"], "Subject", "<p>Hi</p>");
    expect(result).toEqual({ sentCount: 2, failed: [] });
    const [body] = sentBodies();
    expect(body.to).toBe("yanlearnorg@gmail.com");
    expect(body.to).not.toContain("notifications.example.test");
    expect(body.bcc).toEqual(["one@example.test", "two@example.test"]);
    expect(body.from).toBe("YanLearn <learn@notifications.example.test>");
  });

  it("can be sent to another inbox through GROUP_EMAIL_TO", async () => {
    vi.stubEnv("GROUP_EMAIL_TO", "  records@example.test ");
    await notifications.sendBccEmail(["one@example.test"], "Subject", "<p>Hi</p>");
    expect(sentBodies()[0].to).toBe("records@example.test");
  });
});
