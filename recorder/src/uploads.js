// Upload stages are persisted separately so recovery never starts a new
// recording merely because completion or local cleanup failed.
(function (root) {
  "use strict";

  const finishUpload = async (upload, { api, uploadFile, persist }) => {
    if (upload.completed) return { uploaded: true };
    if (!upload.transferComplete) {
      if (!upload.uploadUrl || !upload.recordingId) {
        const created = await api("/api/recorder/recordings", {
          method: "POST",
          body: {
            classId: upload.classId,
            startedAt: new Date(upload.startedAtMs).toISOString(),
            endedAt: new Date(upload.endedAtMs).toISOString(),
            durationSeconds: upload.durationSeconds,
            sizeBytes: upload.sizeBytes,
            uploadReason: upload.reason,
          },
        });
        if ([400, 403, 404].includes(created.status)) {
          return { uploaded: false, error: created.data?.error || created.status };
        }
        if (!created.ok) throw new Error(created.data?.error || `HTTP ${created.status}`);
        upload.recordingId = created.data.recordingId;
        upload.uploadUrl = created.data.uploadUrl;
        upload.transferComplete = created.data.alreadyReady === true;
        await persist(upload);
      }
      if (!upload.transferComplete) {
        const result = await uploadFile({
          path: upload.outputPath,
          url: upload.uploadUrl,
          contentType: "video/mp4",
        });
        if (result.status < 200 || result.status >= 300) {
          upload.uploadUrl = null; // Renew the URL, retaining the capture identity.
          throw new Error(`upload returned ${result.status} ${result.body}`);
        }
        upload.transferComplete = true;
        await persist(upload);
      }
    }
    const completed = await api(`/api/recorder/recordings/${upload.recordingId}/complete`, {
      method: "POST",
      body: { sizeBytes: upload.sizeBytes, durationSeconds: upload.durationSeconds },
    });
    if (!completed.ok) {
      if (completed.status === 409) {
        // The server could not find the uploaded object; allow a fresh PUT.
        upload.transferComplete = false;
        upload.uploadUrl = null;
      }
      throw new Error(completed.data?.error || `HTTP ${completed.status}`);
    }
    upload.completed = true;
    await persist(upload); // Cleanup retries and restarts now need no network calls.
    return { uploaded: true };
  };

  const api = { finishUpload };
  root.RecorderUploads = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
