import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isExecutive as checkIsExecutive, isFounder as checkIsFounder, resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  const isExecutive = checkIsExecutive(role);

  if (!isExecutive) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const isFounder = checkIsFounder(role);

  // Fetch events with nested dates and responses
  let query = supabase
    .from("events")
    .select(`
      *,
      event_dates (
        *,
        event_responses (*)
      )
    `)
    .order("created_at", { ascending: false });

  if (!isFounder) {
    const { data: userData } = await supabase
      .from("app_users")
      .select("is_junior")
      .eq("id", user.id)
      .single();

    const isJunior = userData?.is_junior ?? false;

    if (isJunior) {
      query = query.eq("is_junior_excluded", false);
    }
  }

  const { data: events, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // No longer filtering out past events for anyone, so executives can see all events
  let filteredEvents = events || [];

  // Filter out inactive dates for everyone (is_active may be missing initially, assume true)
  filteredEvents.forEach(event => {
    event.event_dates = event.event_dates.filter((d: any) => d.is_active !== false);
  });

  // Attach user details to responses for founder
  if (isFounder && filteredEvents) {
    const responseUserIds = Array.from(new Set(
      filteredEvents.flatMap(e => e.event_dates.flatMap((d: any) => d.event_responses.map((r: any) => r.user_id)))
    ));

    const { data: allUsers } = await supabase
      .from("app_users")
      .select("id, full_name, email, is_junior, role")
      .in("role", ["executive", "tutor", "founder"]);

    const userMap = new Map(allUsers?.map(u => [u.id, u]) ?? []);

    filteredEvents.forEach(event => {
      event.event_dates.forEach((date: any) => {
        date.event_responses.forEach((resp: any) => {
          resp.user = userMap.get(resp.user_id);
        });
      });

      event.all_executives = (allUsers || []).filter(u =>
        resolveUserRole(u.email, u.role) === "executive" && (!event.is_junior_excluded || !u.is_junior)
      );
    });
  }

  return NextResponse.json({ events: filteredEvents });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!checkIsFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, dates, location, is_junior_excluded, deadline } = body;

  if (!title || !dates || !Array.isArray(dates) || dates.length === 0) {
    return NextResponse.json({ error: "Title and at least one date are required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let finalDeadline = deadline;
  if (!finalDeadline && dates && dates.length > 0) {
    const sorted = [...dates].sort((a, b) => {
      const aStr = typeof a === "string" ? a : a.starts_at;
      const bStr = typeof b === "string" ? b : b.starts_at;
      const dateA = new Date(aStr.length === 10 ? aStr + "T00:00:00" : aStr).getTime();
      const dateB = new Date(bStr.length === 10 ? bStr + "T00:00:00" : bStr).getTime();
      return dateA - dateB;
    });
    const earliestStr = typeof sorted[0] === "string" ? sorted[0] : sorted[0].starts_at;
    const earliestObj = new Date(earliestStr.length === 10 ? earliestStr + "T00:00:00" : earliestStr);
    finalDeadline = earliestObj.toISOString();
  }

  // 1. Create the event
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      title,
      description,
      starts_at: typeof dates[0] === 'string' ? dates[0] : dates[0].starts_at, // Legacy support, remove later
      location,
      is_junior_excluded: !!is_junior_excluded,
      deadline: finalDeadline || (typeof dates[0] === 'string' ? dates[0] : dates[0].starts_at),
      created_by: user.id
    })
    .select()
    .single();

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  // 2. Create the dates
  const datesToInsert = dates.map((d: any) => ({
    event_id: event.id,
    starts_at: typeof d === 'string' ? d : d.starts_at,
    is_time_specified: typeof d === 'string' ? true : !!d.is_time_specified
  }));

  const { error: datesError } = await supabase
    .from("event_dates")
    .insert(datesToInsert);

  if (datesError) {
    // Should ideally rollback, but simple delete for now
    await supabase.from("events").delete().eq("id", event.id);
    return NextResponse.json({ error: datesError.message }, { status: 500 });
  }

  return NextResponse.json({ event });
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!checkIsExecutive(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { event_date_id, attendance } = body;

  if (!event_date_id || !['yes', 'no'].includes(attendance)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Check deadline
  const { data: eventDate, error: dateError } = await supabase
    .from("event_dates")
    .select("event_id, events(deadline)")
    .eq("id", event_date_id)
    .single();

  const deadline = (eventDate as any)?.events?.deadline;
  if (deadline && new Date() > new Date(deadline)) {
    return NextResponse.json({ error: "The deadline for this event has passed." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("event_responses")
    .upsert({
      event_date_id,
      user_id: user.id,
      attendance,
      updated_at: new Date().toISOString()
    }, { onConflict: 'event_date_id,user_id' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ response: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const event_date_id = searchParams.get("event_date_id");

  if (!event_date_id) {
    return NextResponse.json({ error: "Missing event_date_id." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Check deadline
  const { data: eventDate, error: dateError } = await supabase
    .from("event_dates")
    .select("event_id, events(deadline)")
    .eq("id", event_date_id)
    .single();

  const deadline = (eventDate as any)?.events?.deadline;
  if (deadline && new Date() > new Date(deadline)) {
    return NextResponse.json({ error: "The deadline for this event has passed." }, { status: 403 });
  }

  const { error } = await supabase
    .from("event_responses")
    .delete()
    .eq("event_date_id", event_date_id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
export async function PUT(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!checkIsFounder(resolveUserRole(user.email, user.role ?? null))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const { id, title, description, dates, location, is_junior_excluded, deadline } = body;

  if (!id || !title || !dates || !Array.isArray(dates) || dates.length === 0) {
    return NextResponse.json({ error: "ID, title, and at least one date are required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let finalDeadline = deadline;
  if (!finalDeadline && dates && dates.length > 0) {
    const sorted = [...dates].sort((a, b) => {
      const aStr = typeof a === "string" ? a : a.starts_at;
      const bStr = typeof b === "string" ? b : b.starts_at;
      const dateA = new Date(aStr.length === 10 ? aStr + "T00:00:00" : aStr).getTime();
      const dateB = new Date(bStr.length === 10 ? bStr + "T00:00:00" : bStr).getTime();
      return dateA - dateB;
    });
    const earliestStr = typeof sorted[0] === "string" ? sorted[0] : sorted[0].starts_at;
    const earliestObj = new Date(earliestStr.length === 10 ? earliestStr + "T00:00:00" : earliestStr);
    finalDeadline = earliestObj.toISOString();
  }

  // 1. Update the event
  const { error: eventError } = await supabase
    .from("events")
    .update({
      title,
      description,
      location,
      is_junior_excluded: !!is_junior_excluded,
      deadline: finalDeadline || (typeof dates[0] === 'string' ? dates[0] : dates[0].starts_at)
    })
    .eq("id", id);

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  // 2. Sync dates
  // Fetch existing dates
  const { data: existingDates } = await supabase
    .from("event_dates")
    .select("id, starts_at, is_time_specified")
    .eq("event_id", id);

  const normalizeDate = (dString: string) => {
    const t = new Date(dString).getTime();
    return isNaN(t) ? dString : t;
  };

  const getLocalDateString = (dString: string, isTimeSpecified: boolean) => {
    if (!isTimeSpecified) {
      if (!dString.includes('T')) return dString.substring(0, 10);
      try {
        // If it's a UTC midnight representation, the UTC date is the intended day
        return new Date(dString).toISOString().substring(0, 10);
      } catch (e) {
        return dString.substring(0, 10);
      }
    }
    const dt = new Date(dString);
    if (isNaN(dt.getTime())) return dString.substring(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  };

  const unmappedExisting = [...(existingDates || [])];
  
  const updates: any[] = [];
  const inserts: any[] = [];

  for (const d of dates) {
    const startObj = normalizeDate(typeof d === 'string' ? d : d.starts_at);
    const startRaw = typeof d === 'string' ? d : d.starts_at;
    const isTime = typeof d === 'string' ? true : !!d.is_time_specified;

    const dId = typeof d === 'string' ? undefined : d.id;

    // First pass: exact match by explicit ID or exact timestamp
    let exactIndex = -1;
    if (dId) {
      exactIndex = unmappedExisting.findIndex(ex => ex.id === dId);
    }
    if (exactIndex === -1) {
      exactIndex = unmappedExisting.findIndex(ex => normalizeDate(ex.starts_at) === startObj);
    }

    if (exactIndex !== -1) {
      const ex = unmappedExisting[exactIndex];
      unmappedExisting.splice(exactIndex, 1);
      updates.push({
        existingId: ex.id,
        starts_at: startRaw,
        is_time_specified: isTime
      });
      continue;
    }

    // Second pass: same local date
    const targetLocal = getLocalDateString(startRaw, isTime);
    const localIndex = unmappedExisting.findIndex(ex => getLocalDateString(ex.starts_at, ex.is_time_specified) === targetLocal);
    if (localIndex !== -1) {
      const ex = unmappedExisting[localIndex];
      unmappedExisting.splice(localIndex, 1);
      updates.push({
        existingId: ex.id,
        starts_at: startRaw,
        is_time_specified: isTime
      });
      continue;
    }

    // Otherwise, insert
    inserts.push({
      event_id: id,
      starts_at: startRaw,
      is_time_specified: isTime
    });
  }

  // Deactivate whatever is left
  const idsToDeactivate = unmappedExisting.map(ex => ex.id);
  if (idsToDeactivate.length > 0) {
    await supabase.from("event_dates").update({ is_active: false }).in("id", idsToDeactivate);
  }

  if (inserts.length > 0) {
    await supabase.from("event_dates").insert(inserts);
  }

  for (const up of updates) {
    await supabase
      .from("event_dates")
      .update({
        starts_at: up.starts_at,
        is_time_specified: up.is_time_specified,
        is_active: true
      })
      .eq("id", up.existingId);
  }

  return NextResponse.json({ success: true });
}
