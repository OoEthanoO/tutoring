import { afterEach, describe, expect, it, vi } from "vitest";
import { ZenVoiceQueue } from "./zen-voice-queue.mjs";

afterEach(() => vi.useRealTimers());
describe("Zen voice event delivery", () => {
  it("rechecks a student who switches classes while the previous mute is in flight", async () => {
    let finish;
    const deliver = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const queue = new ZenVoiceQueue(deliver);
    queue.add("student");
    queue.add("student");
    queue.add("student");
    queue.add("new-student");
    finish();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(deliver.mock.calls[1][0]).toEqual(["student", "new-student"]);
    queue.stop();
  });
  it("retries busy leases and outages without losing new events", async () => {
    vi.useFakeTimers();
    const deliver = vi.fn().mockRejectedValueOnce(new Error("409")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = new ZenVoiceQueue(deliver);
    queue.add("student");
    await vi.advanceTimersByTimeAsync(0);
    queue.add("arriving");
    await vi.advanceTimersByTimeAsync(250);
    expect(deliver).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(deliver).toHaveBeenCalledTimes(3);
    expect(new Set(deliver.mock.calls[2][0])).toEqual(new Set(["student", "arriving"]));
    expect(queue.pending.size).toBe(0);
    queue.stop();
  });
  it("stops retries during worker shutdown", async () => {
    vi.useFakeTimers();
    const deliver = vi.fn().mockRejectedValue(new Error("offline"));
    const queue = new ZenVoiceQueue(deliver);
    queue.add("student");
    await vi.advanceTimersByTimeAsync(0);
    queue.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
