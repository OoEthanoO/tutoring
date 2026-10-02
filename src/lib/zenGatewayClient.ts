import { timingSafeEqual } from "node:crypto";

/** The worker is private to this host. Never forward its bearer to an arbitrary URL. */
export function zenGatewayUrl(): string | null {
  const port = process.env.YANLEARN_ZEN_GATEWAY_PORT;
  return port && /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
    ? `http://127.0.0.1:${port}` : null;
}

export function isZenWorkerAuthorized(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** null means unavailable; [] means a connected Gateway confirms nobody is in voice. */
export async function getZenVoiceMembers(): Promise<string[] | null> {
  const url = zenGatewayUrl();
  if (!url || !process.env.CRON_SECRET) return null;
  try {
    const response = await fetch(`${url}/voice-members`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      cache: "no-store", signal: AbortSignal.timeout(1000), redirect: "error",
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.ready === true && Array.isArray(body.memberIds) &&
      body.memberIds.every((id: unknown) => typeof id === "string" && /^\d{17,20}$/.test(id))
      ? body.memberIds : null;
  } catch { return null; }
}
