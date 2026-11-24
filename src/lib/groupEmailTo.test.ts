import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Group emails go To a mailbox that accepts mail, never a sending-only
 * address: with one in To, every group email bounced on it (see groupEmailTo).
 */

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail, close: () => {} }) },
}));
vi.mock("@/lib/authServer", () => ({
  getAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

let notifications: typeof import("./notificationsServer");

beforeAll(async () => {
  vi.stubEnv("SMTP_USER", "sender@example.test");
  vi.stubEnv("SMTP_PASSWORD", "app-password");
  notifications = await import("./notificationsServer");
});
afterAll(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<id@example.test>", rejected: [] });
  vi.stubEnv("GROUP_EMAIL_TO", "");
});

const sentMessages = () => sendMail.mock.calls.map(([message]) => message);

describe("group emails", () => {
  it("are addressed to the organization's inbox, with the families in Bcc", async () => {
    const result = await notifications.sendBccEmail(["One@Example.test", "two@example.test"], "Subject", "<p>Hi</p>");
    expect(result).toEqual({ sentCount: 2, failed: [] });
    const [message] = sentMessages();
    expect(message.to).toEqual(["yanlearnorg@gmail.com"]);
    expect(message.bcc).toEqual(["one@example.test", "two@example.test"]);
    expect(message.from).toBe("YanLearn <sender@example.test>");
  });

  it("can be sent to another inbox through GROUP_EMAIL_TO", async () => {
    vi.stubEnv("GROUP_EMAIL_TO", "  records@example.test ");
    await notifications.sendBccEmail(["one@example.test"], "Subject", "<p>Hi</p>");
    expect(sentMessages()[0].to).toEqual(["records@example.test"]);
  });

  it("splits a long list into messages of at most 50 recipients", async () => {
    const families = Array.from({ length: 120 }, (_, index) => `family${index}@example.test`);
    const result = await notifications.sendBccEmail(families, "Subject", "<p>Hi</p>");
    expect(result.sentCount).toBe(120);
    const sizes = sentMessages().map((message) => message.to.length + message.bcc.length);
    expect(sizes).toEqual([50, 50, 23]);
  });
});
