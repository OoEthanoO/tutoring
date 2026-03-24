import { NextResponse, type NextRequest } from "next/server";
import { execSync } from "child_process";

type CommitStat = {
  hash: string;
  date: string;
  message: string;
  added: number;
  removed: number;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const skip = (page - 1) * limit;

    const rawCount = execSync("git rev-list --count HEAD").toString().trim();
    const totalCount = parseInt(rawCount, 10) || 0;

    const rawLog = execSync(
      `git log --skip=${skip} -n ${limit} --numstat --format="COMMIT|%H|%cI|%s"`
    ).toString();

    const commits: CommitStat[] = [];
    const lines = rawLog.split("\n");
    let currentCommit: CommitStat | null = null;

    for (const line of lines) {
      if (line.startsWith("COMMIT|")) {
        if (currentCommit) {
          commits.push(currentCommit);
        }
        const parts = line.split("|");
        const hash = parts[1] || "";
        const date = parts[2] || "";
        const message = parts.slice(3).join("|") || "";

        currentCommit = {
          hash,
          date,
          message,
          added: 0,
          removed: 0,
        };
      } else if (line.trim().length > 0 && currentCommit) {
        const statParts = line.split("\t");
        if (statParts.length >= 2) {
          const addedStr = statParts[0].trim();
          const removedStr = statParts[1].trim();

          if (addedStr !== "-") {
            currentCommit.added += parseInt(addedStr, 10) || 0;
          }
          if (removedStr !== "-") {
            currentCommit.removed += parseInt(removedStr, 10) || 0;
          }
        }
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }

    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      total: totalCount,
      page,
      totalPages,
      commits,
    });
  } catch (err) {
    console.error("Failed to read git commits", err);
    return NextResponse.json(
      { total: 0, page: 1, totalPages: 0, commits: [] },
      { status: 500 }
    );
  }
}
