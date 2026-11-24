import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** SMTP sending and the email_log record (EMAIL.md). */

const { sendMail, createTransport, inserts, insertResult } = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, close: vi.fn() }));
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const insertResult = { error: null as null | { message: string } };
  return { sendMail, createTransport, inserts, insertResult };
});

vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("@/lib/authServer", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return insertResult;
      },
    }),
  }),
}));

import {
  deliverEmail,
  isRetriableEmailError,
  MISSING_EMAIL_CONFIG,
  smtpConfig,
} from "./mailer";

const smtpError = (responseCode: number, response: string) =>
  Object.assign(new Error(response), { responseCode, response });

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<id@example.test>", rejected: [] });
  inserts.length = 0;
  insertResult.error = null;
  vi.stubEnv("SMTP_USER", "org@example.test");
  vi.stubEnv("SMTP_PASSWORD", "abcd efgh ijkl mnop");
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("SMTP_PORT", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("smtpConfig", () => {
  it("needs an account and its password", () => {
    vi.stubEnv("SMTP_PASSWORD", "");
    expect(smtpConfig()).toBeNull();
    vi.stubEnv("SMTP_PASSWORD", "secret");
    vi.stubEnv("SMTP_USER", " ");
    expect(smtpConfig()).toBeNull();
  });

  it("defaults to Gmail on port 587, sending as YanLearn from the account", () => {
    expect(smtpConfig()).toEqual({
      host: "smtp.gmail.com",
      port: 587,
      user: "org@example.test",
      password: "abcdefghijklmnop",
      from: "YanLearn <org@example.test>",
    });
  });

  it("keeps spaces in a password for any other server", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("EMAIL_FROM", "Classes <classes@example.test>");
    expect(smtpConfig()).toMatchObject({
      host: "smtp.example.test",
      port: 465,
      password: "abcd efgh ijkl mnop",
      from: "Classes <classes@example.test>",
    });
  });
});

describe("deliverEmail", () => {
  it("sends nothing and records nothing without settings", async () => {
    vi.stubEnv("SMTP_USER", "");
    expect(await deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" })).toEqual({
      ok: false,
      error: MISSING_EMAIL_CONFIG,
      messageId: null,
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("refuses an email with no recipient", async () => {
    const result = await deliverEmail({ to: " ", bcc: [], subject: "S", html: "<p>H</p>" });
    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("signs in with the app password and sends over STARTTLS", async () => {
    await deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "org@example.test", pass: "abcdefghijklmnop" },
      })
    );
  });

  it("sends one message with Bcc and base64 attachments, and records it without the files", async () => {
    const result = await deliverEmail({
      to: "org@example.test",
      bcc: ["one@example.test", "one@example.test", "org@example.test", "two@example.test"],
      subject: "Reminder",
      html: "<p>Class at 5</p>",
      attachments: [{ filename: "guide.png", content: "aGVsbG8=" }],
    });
    expect(result).toEqual({ ok: true, error: "", messageId: "<id@example.test>" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toEqual({
      from: "YanLearn <org@example.test>",
      to: ["org@example.test"],
      bcc: ["one@example.test", "two@example.test"],
      subject: "Reminder",
      html: "<p>Class at 5</p>",
      attachments: [{ filename: "guide.png", content: "aGVsbG8=", encoding: "base64" }],
    });
    expect(inserts).toEqual([
      {
        table: "email_log",
        row: {
          from_address: "YanLearn <org@example.test>",
          to_addresses: ["org@example.test"],
          bcc_addresses: ["one@example.test", "two@example.test"],
          subject: "Reminder",
          html: "<p>Class at 5</p>",
          attachment_names: ["guide.png"],
          status: "sent",
          error: null,
          message_id: "<id@example.test>",
        },
      },
    ]);
  });

  it("tries again after a temporary refusal", async () => {
    vi.useFakeTimers();
    sendMail
      .mockRejectedValueOnce(smtpError(421, "421 4.7.0 Try again later"))
      .mockResolvedValueOnce({ messageId: "<later@example.test>", rejected: [] });
    const pending = deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, messageId: "<later@example.test>" });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(inserts.map(({ row }) => row.status)).toEqual(["sent"]);
  });

  it("gives up at once on a permanent refusal and records why", async () => {
    sendMail.mockRejectedValue(smtpError(550, "550 5.4.5 Daily user sending limit exceeded."));
    const result = await deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" });
    expect(result).toEqual({
      ok: false,
      error: "550 5.4.5 Daily user sending limit exceeded.",
      messageId: null,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({
      status: "failed",
      error: "550 5.4.5 Daily user sending limit exceeded.",
      message_id: null,
    });
  });

  it("notes addresses the server refused while it took the rest", async () => {
    sendMail.mockResolvedValue({
      messageId: "<id@example.test>",
      rejected: ["bad@example.test", { address: "worse@example.test" }],
    });
    const result = await deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" });
    expect(result.ok).toBe(true);
    expect(inserts[0].row.error).toBe(
      "Refused by the mail server: bad@example.test, worse@example.test"
    );
  });

  it("still reports a sent email when the log cannot be written", async () => {
    insertResult.error = { message: "relation email_log does not exist" };
    const result = await deliverEmail({ to: "a@example.test", subject: "S", html: "<p>H</p>" });
    expect(result.ok).toBe(true);
  });
});

describe("isRetriableEmailError", () => {
  it.each([
    [smtpError(421, "busy"), true],
    [smtpError(451, "local error"), true],
    [smtpError(535, "bad credentials"), false],
    [smtpError(550, "limit"), false],
    [Object.assign(new Error("drop"), { code: "ECONNECTION" }), true],
    [Object.assign(new Error("slow"), { code: "ETIMEDOUT" }), true],
    [Object.assign(new Error("login"), { code: "EAUTH" }), false],
    [new Error("other"), false],
  ])("%s -> %s", (error, expected) => {
    expect(isRetriableEmailError(error)).toBe(expected);
  });
});
