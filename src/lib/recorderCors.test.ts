import { describe, expect, it } from "vitest";
import { isRecorderOrigin, recorderCorsHeaders } from "./recorderCors";

// The whole reason the recorder can talk to the API is that these exact
// origins are allowed: get one wrong and the app is back to "Failed to fetch".
describe("isRecorderOrigin", () => {
  it("allows the webview origins Tauri serves the app from", () => {
    expect(isRecorderOrigin("http://tauri.localhost")).toBe(true); // Windows, Linux
    expect(isRecorderOrigin("https://tauri.localhost")).toBe(true);
    expect(isRecorderOrigin("tauri://localhost")).toBe(true); // macOS
  });

  it("rejects web pages, including look-alike hosts", () => {
    expect(isRecorderOrigin("https://learn.ethanyanxu.com")).toBe(false);
    expect(isRecorderOrigin("https://tauri.localhost.evil.com")).toBe(false);
    expect(isRecorderOrigin("http://localhost:3000")).toBe(false);
    expect(isRecorderOrigin("null")).toBe(false);
    expect(isRecorderOrigin("")).toBe(false);
  });
});

describe("recorderCorsHeaders", () => {
  it("echoes the app's origin and varies on it", () => {
    const headers = recorderCorsHeaders("tauri://localhost");
    expect(headers?.["Access-Control-Allow-Origin"]).toBe("tauri://localhost");
    expect(headers?.Vary).toBe("Origin");
    expect(headers?.["Access-Control-Allow-Headers"]).toContain("Authorization");
  });

  it("sends nothing for a missing or foreign origin", () => {
    expect(recorderCorsHeaders(null)).toBeNull();
    expect(recorderCorsHeaders("https://example.com")).toBeNull();
  });

  it("never allows credentials: the app authenticates with a bearer header", () => {
    const headers = recorderCorsHeaders("http://tauri.localhost");
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });
});
