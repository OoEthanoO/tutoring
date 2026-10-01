import type { NextRequest } from "next/server";
import { getRequestUser } from "@/lib/authServer";
import { isAllowedRequestOrigin } from "@/lib/requestOrigin";
import { getExerciseAccess, readExerciseState, mutateExercise, exerciseJson, exerciseFailure, exerciseBody, ExerciseError } from "@/lib/classExercisesServer";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ classId: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await getExerciseAccess(await getRequestUser(request), (await context.params).classId, false);
    return exerciseJson(await readExerciseState(access, false));
  } catch (error) { return exerciseFailure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedRequestOrigin(request)) throw new ExerciseError("Invalid request origin.", 403);
    const access = await getExerciseAccess(await getRequestUser(request), (await context.params).classId, false);
    await mutateExercise(access, await exerciseBody(request), true);
    return exerciseJson(await readExerciseState(access, false));
  } catch (error) { return exerciseFailure(error); }
}
