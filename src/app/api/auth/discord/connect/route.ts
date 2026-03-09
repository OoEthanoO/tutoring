import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestActor } from "@/lib/authServer";

const discordAuthorizeUrl = "https://discord.com/oauth2/authorize";
const discordStateCookieName = "discord_oauth_state";
const discordStateCookieMaxAgeSeconds = 60 * 10;

const getCallbackUrl = (request: NextRequest) => {
  const configured = String(process.env.DISCORD_OAUTH_REDIRECT_URI ?? "").trim();
  if (configured) {
    return configured;
  }

  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(
    /\/+$/,
    ""
  );
  if (siteUrl) {
    return `${siteUrl}/api/auth/discord/callback`;
  }

  return `${request.nextUrl.origin}/api/auth/discord/callback`;
};

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const discordClientId = String(process.env.DISCORD_CLIENT_ID ?? "").trim();
  if (!discordClientId) {
    return NextResponse.json(
      { error: "Missing DISCORD_CLIENT_ID." },
      { status: 500 }
    );
  }

  const callbackUrl = getCallbackUrl(request);
  const state = crypto.randomBytes(24).toString("hex");
  const statePayload = `${actor.id}:${state}`;

  const params = new URLSearchParams({
    client_id: discordClientId,
    response_type: "code",
    scope: "identify",
    redirect_uri: callbackUrl,
    state,
    prompt: "consent",
  });

  const response = NextResponse.redirect(`${discordAuthorizeUrl}?${params.toString()}`);
  response.cookies.set({
    name: discordStateCookieName,
    value: statePayload,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: discordStateCookieMaxAgeSeconds,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
