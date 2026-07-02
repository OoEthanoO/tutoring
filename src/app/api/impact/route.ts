import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/authServer";
import { computeCoreTotals, loadCoreRows } from "@/lib/impactStats";

// Public endpoint: aggregate, non-personal numbers only. Cached for an hour so
// anonymous traffic doesn't re-scan the tables on every visit; the handler uses
// no request data, which keeps it statically cacheable.
export const revalidate = 3600;

export async function GET() {
  try {
    const rows = await loadCoreRows(getAdminClient());
    // Shared with the founder analytics dashboard so the numbers never drift.
    const { totals } = computeCoreTotals(rows);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      hoursTaught: totals.hours.taught,
      classesTaught: totals.hours.classesTaught,
      courses: { total: totals.courses.total, completed: totals.courses.completed },
      enrollments: totals.enrollments.total,
      students: totals.verifiedUsers.students,
      tutors: totals.verifiedUsers.executives,
      raised: totals.raised,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load impact stats." },
      { status: 500 }
    );
  }
}
