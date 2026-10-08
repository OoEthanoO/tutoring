import { normalize, RETENTION_MS } from "../../recorder/src/diagnostics";
export { normalize as normalizeRecorderDiagnostics, RETENTION_MS as recorderDiagnosticsRetentionMs };
export type { DiagnosticReport } from "../../recorder/src/diagnostics";

export const diagnosticsBodyLimit = 160 * 1024;

/** Bound the stream before parsing, including bodies without Content-Length. */
export const readDiagnosticsBody = async (request: Request): Promise<unknown> => {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > diagnosticsBodyLimit) {
        await reader.cancel();
        throw new RangeError("Diagnostics report is too large.");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
};
