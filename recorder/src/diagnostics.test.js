import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { redact, normalize, recorderState, createReporter, RETENTION_MS, MAX_LOGS } = require("./diagnostics.js");
const now = Date.parse("2026-10-08T01:00:00Z");

describe("Recorder diagnostic privacy", () => {
  it("removes credentials, emails, signed URLs, local paths and known window titles before transmission", () => {
    const inputs = [
      'Authorization: Bearer short-secret', 'password="my secret"', 'token=abc123',
      'student@example.test', 'https://bucket.test/video?X-Amz-Signature=private',
      'failed at C:\\Users\\Private Person\\Documents\\private file.mp4',
      'failed at /Users/private/Library/Application Support/Recorder/file.mp4',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private-signature',
      'Window My private document cannot be recorded',
    ];
    const output = inputs.map((s) => redact(s, ["My private document", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private-signature"])).join("\n");
    for (const secret of ["short-secret", "my secret", "abc123", "student@", "bucket.test", "Private Person", "Application Support", "private-signature", "My private document"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("cannot be recorded");
  });

  it("allowlists report fields and bounds log age, count and line length", () => {
    const report = normalize({ schema: 1, state: "capture_failed", token: "secret", settings: { password: "secret" },
      screen: "private", exercise: "student answer", captureFailures: Infinity,
      logs: Array.from({ length: 200 }, () => ({ at: new Date(now).toISOString(), message: "x ".repeat(500) })),
    }, now);
    expect(report.logs).toHaveLength(MAX_LOGS);
    expect(report.logs[0].message.length).toBeLessThanOrEqual(400);
    expect(report.captureFailures).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/secret|private|student answer/);
    expect(normalize({ schema: 1, state: "idle", logs: [{ at: new Date(now - RETENTION_MS - 1).toISOString(), message: "old" }] }, now).logs).toEqual([]);
    expect(normalize({ schema: 1, state: "test" }, now)).toBeNull();
  });
});

describe("Recorder diagnostic reporting", () => {
  const setup = () => {
    let time = now;
    const ctx = { userId: "one", deviceId: "device", signedIn: true, test: false, privateValues: ["private title"], report: { state: "idle" } };
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createReporter({ context: () => ctx, send, now: () => time });
    return { ctx, send, reporter, advance: () => { time += 30000; } };
  };
  it("excludes practice activity even after practice ends, and sends nothing while signed out", async () => {
    const { ctx, send, reporter } = setup();
    ctx.test = true;
    reporter.record("practice secret");
    await reporter.flush();
    expect(send).not.toHaveBeenCalled();
    ctx.test = false;
    ctx.signedIn = false;
    await reporter.flush();
    expect(send).not.toHaveBeenCalled();
    ctx.signedIn = true;
    reporter.record("Capture failed on private title");
    await reporter.flush();
    expect(send.mock.calls[0][1].logs.map((l) => l.message)).toEqual(["Capture failed on [private]"]);
  });
  it("does not send a previous account's logs after an account switch", async () => {
    const { ctx, send, reporter } = setup();
    reporter.record("first tutor's class");
    ctx.userId = "two";
    reporter.record("second tutor's class");
    await reporter.flush();
    expect(send.mock.calls[0][1].logs).toHaveLength(1);
    expect(send.mock.calls[0][1].logs[0].message).toBe("second tutor's class");
  });
  it("caps cadence and overlapping requests, and tolerates diagnostics outages", async () => {
    const { send, reporter, advance } = setup();
    let reject;
    send.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = reporter.flush();
    advance();
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    reject(new Error("offline"));
    await expect(pending).resolves.toBeUndefined();
    await reporter.flush();
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not break the recording loop if diagnostic context itself fails", async () => {
    const reporter = createReporter({ context: () => { throw new Error("unavailable"); }, send: vi.fn() });
    expect(() => reporter.record("failed capture")).not.toThrow();
    await expect(reporter.flush()).resolves.toBeUndefined();
  });
});

describe("Recorder reported reasons", () => {
  const context = { session: { phase: "live", inCall: true, pauseMode: "none" }, ready: true, online: true };
  it.each([
    [{ captureDisabled: true }, "capture_failed"],
    [{ pauseMode: "manual" }, "paused_manual"],
    [{ inCall: false }, "waiting_for_voice"],
    [{ phase: "after_end", finalizeReason: "channel_deleted" }, "preparation_failed"],
    [{ capturing: true, activeTarget: { kind: "frozen" } }, "recording"],
  ])("explains why capture is stopped without asserting Discord attendance: %j", (changes, expected) => {
    expect(recorderState({ ...context, session: { ...context.session, ...changes } })).toBe(expected);
  });
  it("distinguishes device selection and connection failures", () => {
    expect(recorderState({ ...context, ready: false })).toBe("waiting_for_devices");
    expect(recorderState({ ...context, online: false })).toBe("reconnecting");
  });
});
