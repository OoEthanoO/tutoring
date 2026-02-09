import { NextResponse, type NextRequest } from "next/server";
import { getRequestAuthContext } from "@/lib/authServer";

export async function GET(request: NextRequest) {
  const auth = await getRequestAuthContext(request);
  if (!auth.user) {
    return NextResponse.json(
      {
        user: null,
        actor: null,
        isImpersonating: false,
        impersonatedUserId: null,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    user: auth.user,
    actor: auth.actor,
    isImpersonating: auth.isImpersonating,
    impersonatedUserId: auth.impersonatedUserId,
  });
}
