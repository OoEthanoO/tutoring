import { describe, expect, it } from "vitest";
import { diagnosticsBodyLimit, normalizeRecorderDiagnostics, readDiagnosticsBody } from "./recorderDiagnostics";

describe("server diagnostics boundary", () => {
  it("uses the same redaction and allowlist for directly submitted reports", () => {
    const result = normalizeRecorderDiagnostics({ schema: 1, state: "paused", settings: "secret",
      logs: [{ at: new Date().toISOString(), message: "Bearer secret-token failed" }] });
    expect(result?.logs[0].message).toBe("[authorization] failed");
    expect(result).not.toHaveProperty("settings");
  });
  it("limits bodies even without a Content-Length", async () => {
    const request = new Request("https://example.test", { method: "POST", body: "x".repeat(diagnosticsBodyLimit + 1) });
    await expect(readDiagnosticsBody(request)).rejects.toBeInstanceOf(RangeError);
  });
  it("rejects malformed JSON", async () => {
    await expect(readDiagnosticsBody(new Request("https://example.test", { method: "POST", body: "{" }))).rejects.toBeInstanceOf(SyntaxError);
  });
});
