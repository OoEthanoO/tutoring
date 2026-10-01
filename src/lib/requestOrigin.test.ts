import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedRequestOrigin } from "./requestOrigin";

const site = "https://learn.ethanyanxu.com";
const request = (origin: string | null, url = "http://127.0.0.1:3101/api/example", extra = {}) =>
  new Request(url, { headers: { ...(origin === null ? {} : { origin }), ...extra } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("public browser origin behind the reverse proxy", () => {
  it("accepts the configured HTTPS origin over an internal HTTP connection", () => {
    expect(isAllowedRequestOrigin(request(site))).toBe(true);
    expect(isAllowedRequestOrigin(request(site, site + "/api/example"))).toBe(true);
  });
  it("normalizes the configured site URL, including its trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", ` ${site}/ `);
    expect(isAllowedRequestOrigin(request(site))).toBe(true);
  });
  it.each([
    "https://unrelated.example", "https://learn.ethanyanxu.com.evil.example",
    "http://learn.ethanyanxu.com", "https://learn.ethanyanxu.com:8443",
    "http://127.0.0.1:3101", "null", "", `${site}/path`,
    `${site}, https://unrelated.example`,
  ])("rejects an untrusted or invalid Origin: %s", origin => {
    expect(isAllowedRequestOrigin(request(origin))).toBe(false);
  });
  it("does not trust a matching attacker-supplied host or forwarded headers", () => {
    const evil = "https://unrelated.example";
    expect(isAllowedRequestOrigin(request(evil, evil + "/api/example", {
      host: "unrelated.example", "x-forwarded-host": "unrelated.example", "x-forwarded-proto": "https",
    }))).toBe(false);
  });
  it("keeps production restricted to YanLearn when the setting is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
    expect(isAllowedRequestOrigin(request(site))).toBe(true);
    expect(isAllowedRequestOrigin(request("https://unrelated.example", "https://unrelated.example/api"))).toBe(false);
  });
  it("fails closed when the configured URL is invalid", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a URL");
    expect(isAllowedRequestOrigin(request(site))).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "file:///tmp/site");
    expect(isAllowedRequestOrigin(request("null"))).toBe(false);
  });
  it("supports same-origin local development without a configured URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(isAllowedRequestOrigin(request("http://localhost:3000", "http://localhost:3000/api/example"))).toBe(true);
    expect(isAllowedRequestOrigin(request("https://unrelated.example", "http://localhost:3000/api/example"))).toBe(false);
  });
  it("preserves authenticated non-browser requests without an Origin header", () => {
    expect(isAllowedRequestOrigin(request(null))).toBe(true);
  });
});
