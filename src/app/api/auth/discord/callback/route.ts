import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, getRequestActor } from "@/lib/authServer";

const discordTokenUrl = "https://discord.com/api/v10/oauth2/token";
const discordIdentityUrl = "https://discord.com/api/v10/users/@me";
const discordStateCookieName = "discord_oauth_state";
const defaultDiscordInviteUrl = "https://discord.gg/yDMdWcs64R";

type DiscordTokenResponse = {
  access_token?: string;
};

type DiscordIdentity = {
  id?: string;
  username?: string;
  discriminator?: string;
};

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

const getRedirectBackUrl = (request: NextRequest, status: string) => {
  const url = new URL("/", request.url);
  url.searchParams.set("discord", status);
  return url;
};

const getDiscordInviteUrl = () => {
  const configured = String(
    process.env.DISCORD_SERVER_INVITE_URL ??
    process.env.NEXT_PUBLIC_DISCORD_SERVER_INVITE_URL ??
    ""
  ).trim();
  const value = configured || defaultDiscordInviteUrl;
  if (
    value.startsWith("https://discord.gg/") ||
    value.startsWith("https://discord.com/invite/")
  ) {
    return value;
  }
  return defaultDiscordInviteUrl;
};

const clearStateCookie = (response: NextResponse) => {
  response.cookies.set({
    name: discordStateCookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
};

const formatDiscordUsername = (identity: DiscordIdentity) => {
  const username = String(identity.username ?? "").trim();
  const discriminator = String(identity.discriminator ?? "").trim();
  if (!username) {
    return "";
  }
  if (discriminator && discriminator !== "0") {
    return `${username}#${discriminator}`;
  }
  return username;
};

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const redirectWithStatus = (status: string) => {
    const response = NextResponse.redirect(getRedirectBackUrl(request, status));
    clearStateCookie(response);
    return response;
  };

  const stateFromQuery = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const stateFromCookie =
    request.cookies.get(discordStateCookieName)?.value?.trim() ?? "";

  const [stateUserId = "", expectedState = ""] = stateFromCookie.split(":");
  if (!stateFromQuery || !stateFromCookie) {
    return redirectWithStatus("state_missing");
  }
  if (stateUserId !== actor.id || expectedState !== stateFromQuery) {
    return redirectWithStatus("state_invalid");
  }

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return redirectWithStatus("oauth_error");
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return redirectWithStatus("code_missing");
  }

  const discordClientId = String(process.env.DISCORD_CLIENT_ID ?? "").trim();
  const discordClientSecret = String(
    process.env.DISCORD_CLIENT_SECRET ?? ""
  ).trim();
  if (!discordClientId || !discordClientSecret) {
    return redirectWithStatus("config_missing");
  }

  const callbackUrl = getCallbackUrl(request);
  const tokenBody = new URLSearchParams({
    client_id: discordClientId,
    client_secret: discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
  });

  const tokenResponse = await fetch(discordTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });

  if (!tokenResponse.ok) {
    return redirectWithStatus("token_exchange_failed");
  }

  const tokenData = (await tokenResponse.json().catch(() => null)) as
    | DiscordTokenResponse
    | null;
  const accessToken = String(tokenData?.access_token ?? "").trim();
  if (!accessToken) {
    return redirectWithStatus("token_missing");
  }

  const identityResponse = await fetch(discordIdentityUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!identityResponse.ok) {
    return redirectWithStatus("identity_fetch_failed");
  }

  const identity = (await identityResponse.json().catch(() => null)) as
    | DiscordIdentity
    | null;
  const discordUserId = String(identity?.id ?? "").trim();
  const discordUsername = formatDiscordUsername(identity ?? {});

  if (!discordUserId || !discordUsername) {
    return redirectWithStatus("identity_invalid");
  }

  const adminClient = getAdminClient();
  const { data: existingUser, error: existingUserError } = await adminClient
    .from("app_users")
    .select("id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (existingUserError) {
    return redirectWithStatus("lookup_failed");
  }

  if (existingUser && existingUser.id !== actor.id) {
    return redirectWithStatus("already_linked");
  }

  const { error: updateError } = await adminClient
    .from("app_users")
    .update({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      discord_connected_at: new Date().toISOString(),
    })
    .eq("id", actor.id);

  if (updateError) {
    return redirectWithStatus("link_failed");
  }

  const response = NextResponse.redirect(getDiscordInviteUrl());
  clearStateCookie(response);
  return response;
}
