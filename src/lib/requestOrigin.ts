/**
 * Cookie-authenticated mutations must compare the browser Origin to our public
 * URL. Behind Caddy, request.url can contain the loopback HTTP origin instead.
 * Host and forwarded headers are caller-controlled and cannot expand this list.
 */
export function isAllowedRequestOrigin(request: Pick<Request, "headers" | "url">): boolean {
  const origin = request.headers.get("origin");
  // Preserve non-browser clients; authentication and authorization still apply.
  if (origin === null) return true;

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const expected = configured || (process.env.NODE_ENV === "production"
    ? "https://learn.ethanyanxu.com"
    : request.url);
  try {
    const url = new URL(expected);
    return (url.protocol === "https:" || url.protocol === "http:") && origin === url.origin;
  } catch {
    return false;
  }
}
