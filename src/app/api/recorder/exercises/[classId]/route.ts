import { getRecorderUser } from "@/lib/recorderAuth";
import { getExerciseAccess, readExerciseState, mutateExercise, exerciseJson, exerciseFailure, exerciseBody } from "@/lib/classExercisesServer";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ classId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const access = await getExerciseAccess(await getRecorderUser(request), (await context.params).classId, true);
    return exerciseJson(await readExerciseState(access, true, new URL(request.url).searchParams.get("questionId")));
  } catch (error) { return exerciseFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const access = await getExerciseAccess(await getRecorderUser(request), (await context.params).classId, true);
    await mutateExercise(access, await exerciseBody(request), false);
    return exerciseJson(await readExerciseState(access, true, new URL(request.url).searchParams.get("questionId")));
  } catch (error) { return exerciseFailure(error); }
}
