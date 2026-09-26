import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import {
  BreakoutError,
  getBreakoutAccess,
  readBreakoutAction,
  readBreakoutState,
  runBreakoutAction,
} from "@/lib/breakoutRoomsServer";

/**
 * A class's breakout rooms: GET for who is where, POST to open rooms, split
 * the students into them, or close them. Tutors of the course and the founder
 * trio only. See src/lib/breakoutRooms.ts.
 */

export const dynamic = "force-dynamic";
// Moving a class of students one by one can take a while on Discord's limits.
export const maxDuration = 60;

type Context = { params: Promise<{ classId: string }> };

const failure = (error: unknown) => {
  if (error instanceof BreakoutError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Breakout rooms failed:", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Breakout rooms failed." },
    { status: 502 }
  );
};

export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await getBreakoutAccess(await getRequestUser(request), (await context.params).classId);
    return NextResponse.json(await readBreakoutState(access));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new BreakoutError("Invalid request origin.", 403);
    }
    const access = await getBreakoutAccess(await getRequestUser(request), (await context.params).classId);
    const action = readBreakoutAction(await request.json().catch(() => null));
    const problems = await runBreakoutAction(access, action);
    return NextResponse.json({ ...(await readBreakoutState(access)), problems });
  } catch (error) {
    return failure(error);
  }
}
