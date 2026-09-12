import { describe, expect, it, vi } from "vitest";
import uploads from "./uploads.js";

const pending = () => ({
  classId: "class-4", startedAtMs: Date.parse("2026-09-09T19:00:00Z"),
  endedAtMs: Date.parse("2026-09-09T20:02:00Z"), durationSeconds: 3720,
  sizeBytes: 123456789, reason: "tutor_confirmed", outputPath: "recording.mp4",
  recordingId: null, uploadUrl: null,
});
const created = { ok: true, status: 200, data: { recordingId: "one", uploadUrl: "signed-url" } };
const completed = { ok: true, status: 200, data: { ok: true } };
const setup = () => ({
  api: vi.fn(async (url) => url.endsWith("/complete") ? completed : created),
  uploadFile: vi.fn(async () => ({ status: 200 })),
  persist: vi.fn(async () => {}),
});

describe("Recorder upload recovery", () => {
  it("retries a failed completion without PUTting the video again, including after restart", async () => {
    const upload = pending();
    const deps = setup();
    deps.api.mockResolvedValueOnce(created).mockRejectedValueOnce(new Error("response lost"));
    let persisted;
    deps.persist.mockImplementation(async (value) => { persisted = JSON.parse(JSON.stringify(value)); });
    await expect(uploads.finishUpload(upload, deps)).rejects.toThrow("response lost");
    expect(persisted.transferComplete).toBe(true);
    await expect(uploads.finishUpload(persisted, deps)).resolves.toEqual({ uploaded: true });
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.api.mock.calls.map(([url]) => url)).toEqual([
      "/api/recorder/recordings", "/api/recorder/recordings/one/complete", "/api/recorder/recordings/one/complete",
    ]);
  });

  it("renews an expired URL without dropping the capture identity", async () => {
    const upload = pending();
    const deps = setup();
    deps.uploadFile.mockResolvedValueOnce({ status: 403, body: "expired" });
    await expect(uploads.finishUpload(upload, deps)).rejects.toThrow("expired");
    expect(upload.recordingId).toBe("one");
    expect(upload.uploadUrl).toBeNull();
    await uploads.finishUpload(upload, deps);
    const requests = deps.api.mock.calls.filter(([url]) => url === "/api/recorder/recordings");
    expect(requests[1][1].body).toEqual(requests[0][1].body);
  });

  it("skips transfer when the recovered capture is already ready on the server", async () => {
    const deps = setup();
    deps.api.mockResolvedValueOnce({ ...created, data: { ...created.data, alreadyReady: true } });
    await uploads.finishUpload(pending(), deps);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.api).toHaveBeenCalledWith("/api/recorder/recordings/one/complete", expect.anything());
  });

  it("does no network work when cleanup failed after successful completion", async () => {
    const upload = pending();
    const deps = setup();
    await uploads.finishUpload(upload, deps);
    expect(upload.completed).toBe(true);
    const recovered = JSON.parse(JSON.stringify(upload));
    deps.api.mockClear();
    deps.uploadFile.mockClear();
    await uploads.finishUpload(recovered, deps);
    expect(deps.api).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it("still handles pending files from older Recorder versions", async () => {
    const upload = { ...pending(), recordingId: "one", uploadUrl: "old-url" };
    const deps = setup();
    await uploads.finishUpload(upload, deps);
    expect(deps.api.mock.calls.map(([url]) => url)).toEqual(["/api/recorder/recordings/one/complete"]);
    expect(upload.completed).toBe(true);
  });

  it("retransfers if completion says the stored object is missing", async () => {
    const upload = { ...pending(), recordingId: "one", transferComplete: true };
    const deps = setup();
    deps.api.mockResolvedValueOnce({ ok: false, status: 409, data: { error: "object missing" } });
    await expect(uploads.finishUpload(upload, deps)).rejects.toThrow("object missing");
    await uploads.finishUpload(upload, deps);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("does not upload a file the server has refused", async () => {
    const deps = setup();
    deps.api.mockResolvedValueOnce({ ok: false, status: 403, data: { error: "not your class" } });
    expect(await uploads.finishUpload(pending(), deps)).toEqual({ uploaded: false, error: "not your class" });
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });
});
