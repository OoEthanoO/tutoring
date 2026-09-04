/**
 * CORS for the YanLearn Recorder desktop app.
 *
 * The app's webview is a real browser origin — `http://tauri.localhost` on
 * Windows and Linux, `tauri://localhost` on macOS — so every request it makes
 * to /api/recorder/** is cross-origin, and the browser drops the response
 * unless we allow that origin. Without this the app cannot even sign in
 * ("TypeError: Failed to fetch").
 *
 * Only the app's own origins are allowed: these routes are bearer-token
 * authenticated and must not become callable from arbitrary web pages. No
 * `Allow-Credentials` — the app sends a bearer header, never a cookie.
 */

/** The webview origins Tauri 2 serves the app from. */
export const isRecorderOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    // macOS / iOS serve the app over a custom scheme.
    if (url.protocol === "tauri:") {
      return true;
    }
    // Windows and Linux use a synthetic http(s) host.
    return url.hostname === "tauri.localhost";
  } catch {
    return false;
  }
};

export const recorderCorsHeaders = (origin: string | null): Record<string, string> | null => {
  if (!origin || !isRecorderOrigin(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    // The allowed origin is echoed back, so caches must key on it.
    Vary: "Origin",
  };
};
