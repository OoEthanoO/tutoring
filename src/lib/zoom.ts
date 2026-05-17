/**
 * Get a valid Zoom access token for Server-to-Server OAuth
 * Tokens expire after 3600 seconds, but we cache them to avoid excessive requests
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getZoomAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && now < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Missing Zoom OAuth credentials in environment variables");
  }

  // Server-to-Server OAuth: account_credentials grant with Basic auth
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Host: "zoom.us",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: accountId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Zoom OAuth failed: ${error.error_description || error.error}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

interface ZoomMeetingOptions {
  topic: string;
  start_time: string; // ISO 8601 format
  duration: number; // minutes
  password?: string;
  settings?: Record<string, unknown>;
}

/**
 * Create a Zoom meeting
 * Returns meeting ID and URLs for host and participants
 */
export async function createZoomMeeting(options: ZoomMeetingOptions) {
  const accessToken = await getZoomAccessToken();

  const meetingData = {
    topic: options.topic,
    type: 2, // Scheduled meeting
    start_time: options.start_time,
    duration: options.duration,
    timezone: "America/New_York",
    password: options.password || Math.random().toString(36).substring(7).toUpperCase(),
    settings: {
      host_video: true,
      participant_video: true,
      waiting_room: false,
      approval_type: 1, // Manual registration approval
      join_before_host: false,
      meeting_authentication: false,
      participants_video: true,
      enforced_login_domains: "",
      ...options.settings,
    },
  };

  const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meetingData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create Zoom meeting: ${error.message || error.error}`);
  }

  const meeting = (await response.json()) as {
    id: number;
    join_url: string;
    start_url: string;
    password: string;
  };

  return {
    meetingId: meeting.id.toString(),
    joinUrl: meeting.join_url,
    startUrl: meeting.start_url,
    password: meeting.password,
  };
}

interface ZoomRegistrantData {
  email: string;
  first_name: string;
  last_name?: string;
}

/**
 * Register a participant for a Zoom meeting to generate a unique join URL
 */
export async function registerZoomParticipant(
  meetingId: string,
  registrant: ZoomRegistrantData
) {
  const accessToken = await getZoomAccessToken();

  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(registrant),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Failed to register Zoom participant: ${error.message || error.error}`
    );
  }

  const data = (await response.json()) as {
    registrant_id: string;
    join_url: string;
  };

  return {
    registrantId: data.registrant_id,
    joinUrl: data.join_url,
  };
}

/**
 * End a Zoom meeting immediately.
 * Falls back to delete when ending is not supported by current account settings.
 */
export async function deleteZoomMeeting(meetingId: string) {
  const accessToken = await getZoomAccessToken();

  // Prefer ending the meeting session to avoid requiring delete-specific scopes.
  const endResponse = await fetch(
    `https://api.zoom.us/v2/meetings/${meetingId}/status`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "end" }),
    }
  );

  if (endResponse.ok || endResponse.status === 204) {
    return true;
  }

  // Fallback: attempt delete for accounts where end is disallowed but delete is granted.
  const deleteResponse = await fetch(
    `https://api.zoom.us/v2/meetings/${meetingId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (deleteResponse.ok || deleteResponse.status === 204) {
    return true;
  }

  const endError = await endResponse.text().catch(() => "");
  const deleteError = await deleteResponse.text().catch(() => "");
  throw new Error(
    `Failed to end or delete Zoom meeting. end=${endResponse.status} ${endError}; delete=${deleteResponse.status} ${deleteError}`
  );
}

/**
 * Get Zoom meeting details including participant count
 */
export async function getZoomMeetingDetails(meetingId: string) {
  const accessToken = await getZoomAccessToken();

  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Zoom meeting details: ${error.message || error.error}`);
  }

  return await response.json();
}
